// The real EntryPreparer (S04.05, S04.06's TODO): translation, the one mapper, the text messages rendered once and the hash. The
// translator is a stub that returns whole sets; the renderer and the hash are the real ones.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Translated } from "../../../contracts/translated";
import { AlertRoutesUnavailableError } from "../../translation";
import { SMS_MAX_BODY_LENGTH } from "../../messaging";
import type { EntryContent } from "../domain/content";
import { FROZEN_LANGS, type FrozenTranslation } from "../domain/translations";
import { freezeContent } from "./freezeContent";
import { createEntryPreparer, type EntryTranslator } from "./prepareEntry";
import type { PrepareContext } from "./ports";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const BASE = "https://cvh.example";

const contentOf = (over: Partial<EntryContent> = {}): EntryContent => ({
  text: "The elevator is out of service.",
  types: ["elevator"],
  audience: { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["elevator"] },
  phase: "problem",
  validUntil: new Date("2026-10-04T12:00:00Z"),
  ...over,
});
const context = (over: Partial<PrepareContext> = {}): PrepareContext => ({
  alertId: "01900000-0000-7000-8000-0000000000a1",
  entryId: "01900000-0000-7000-8000-0000000000e1",
  isDrill: false,
  kind: "ack",
  supersedesId: null,
  channels: ["sms", "web"],
  slug: "k3x9a2bc",
  verified: true,
  attribution: { role: "hub" },
  ...over,
});

/** A whole set for an English text: every language translated (a text of its own), zh-Hant converted from zh. */
function wholeSet(english: string, over: Record<string, Partial<Translated> & { status: Translated["status"] }> = {}): Translated[] {
  const source = sha(english);
  const zh = `${english} (zh)`;
  return FROZEN_LANGS.map((lang): Translated => {
    const given = over[lang];
    if (given?.status === "fallback_en") return { lang, body: english, machine: false, model: null, status: "fallback_en", source_hash: given.source_hash ?? source };
    if (lang === "zh-Hant") {
      return { lang, body: `${english} (zh-Hant)`, machine: true, model: "opencc-js 1.4.2", status: "script_converted", source_hash: source, conversion: { from: "zh", from_text_hash: sha(zh), opencc_version: "1.4.2", config: "test" } };
    }
    return { lang, body: lang === "zh" ? zh : `${english} (${lang})`, machine: true, model: "m1", status: "ok", source_hash: given?.source_hash ?? source };
  });
}

function setup(translate: EntryTranslator["translate"]) {
  return createEntryPreparer({ translator: { translate }, freeze: (input) => freezeContent({ ...input, publicBaseUrl: BASE }) });
}

describe("the preparer", () => {
  it("translates the draft's English, maps the whole set, renders every language once and hashes it all", async () => {
    const content = contentOf();
    const prepare = setup(async ({ english }) => ({ translations: wholeSet(english) }));

    const result = await prepare.prepare(content, context());

    if (!result.ok) throw new Error("expected a freeze");
    expect(result.value.translations.map((text) => text.lang)).toEqual([...FROZEN_LANGS]);
    // A text message goes to a subscriber's launch language: zh-Hant is a script of the web text, not a language of its own to text in.
    expect(Object.keys(result.value.smsBodies).sort()).toEqual(["en", ...FROZEN_LANGS.filter((lang) => lang !== "zh-Hant")].sort());
    expect(result.value.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.value.smsBodies.en.body).toContain(`${BASE}/a/k3x9a2bc`);
    // The one mapper's vocabulary: a model's text is stored as `translated`, the conversion keeps its record.
    expect(result.value.translations.find((text) => text.lang === "ur")?.status).toBe("translated");
    expect(result.value.translations.find((text) => text.lang === "zh-Hant")).toMatchObject({ status: "script_converted", conversion: { from: "zh", openccVersion: "1.4.2" } });
  });

  it("gives the same content the same hash, and another text another", async () => {
    const prepare = setup(async ({ english }) => ({ translations: wholeSet(english) }));

    const a = await prepare.prepare(contentOf(), context());
    const again = await prepare.prepare(contentOf(), context());
    const other = await prepare.prepare(contentOf({ text: "The elevator is working again." }), context());

    if (!a.ok || !again.ok || !other.ok) throw new Error("expected freezes");
    expect(again.value.contentHash).toBe(a.value.contentHash);
    expect(other.value.contentHash).not.toBe(a.value.contentHash);
  });

  it("puts the 911 line first for fire and 'Other', and last for every other type, in the English text message it freezes", async () => {
    const prepare = setup(async ({ english }) => ({ translations: wholeSet(english) }));
    const bodyOf = async (type: string) => {
      const result = await prepare.prepare(contentOf({ types: [type], audience: { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: [type] } }), context());
      if (!result.ok) throw new Error("expected a freeze");
      return result.value.smsBodies.en.body.split("\n");
    };

    for (const type of ["fire", "other"]) {
      const lines = await bodyOf(type);
      expect(lines[0], `${type}: the 911 line is first`).toMatch(/911/);
      expect(lines.filter((line) => /911/.test(line))).toHaveLength(1);
    }
    for (const type of ["power", "elevator", "heat"]) {
      const lines = await bodyOf(type);
      expect(lines[0], `${type}: the 911 line is not first`).not.toMatch(/911/);
      expect(lines.filter((line) => /911/.test(line))).toHaveLength(1);
    }
  });

  it("says which languages settled as they do, in the mapper's words", async () => {
    const settled: FrozenTranslation[] = [];
    const prepare = setup(async ({ english, onLanguage }) => {
      const set = wholeSet(english, { ps: { status: "fallback_en" } });
      for (const translated of set) onLanguage?.(translated);
      return { translations: set };
    });

    await prepare.prepare(contentOf(), context(), { onLanguage: (translation) => settled.push(translation) });

    expect(settled).toHaveLength(15);
    expect(settled.find((text) => text.lang === "ps")).toMatchObject({ status: "fallback_en", machine: false, model: null });
    expect(settled.find((text) => text.lang === "ur")?.status).toBe("translated");
  });

  it("passes the budget and the cancel through to the translator", async () => {
    const seen: { signal?: AbortSignal; budgets: number[] } = { budgets: [] };
    const prepare = setup(async ({ english, signal, onBudget }) => {
      seen.signal = signal;
      onBudget?.(25_000);
      return { translations: wholeSet(english) };
    });
    const cancel = new AbortController();

    await prepare.prepare(contentOf(), context(), { signal: cancel.signal, onBudget: (ms) => seen.budgets.push(ms) });

    expect(seen.signal).toBe(cancel.signal);
    expect(seen.budgets).toEqual([25_000]);
  });

  it("tells the translator which entry it translates for and whether it is a drill's, so the vendor's usage is told per alert (S07.10)", async () => {
    const seen: ({ entryId: string; isDrill: boolean } | undefined)[] = [];
    const prepare = setup(async ({ english, entry }) => {
      seen.push(entry);
      return { translations: wholeSet(english) };
    });

    await prepare.prepare(contentOf(), context({ entryId: "01900000-0000-7000-8000-0000000000e9", isDrill: true }));
    await prepare.prepare(contentOf(), context());

    expect(seen).toEqual([
      { entryId: "01900000-0000-7000-8000-0000000000e9", isDrill: true },
      { entryId: "01900000-0000-7000-8000-0000000000e1", isDrill: false },
    ]);
  });

  it("is not changed by a progress callback that throws", async () => {
    const prepare = setup(async ({ english, onLanguage }) => {
      const set = wholeSet(english);
      for (const translated of set) onLanguage?.(translated);
      return { translations: set };
    });

    const result = await prepare.prepare(contentOf(), context(), {
      onLanguage: () => {
        throw new Error("screen gone");
      },
    });

    expect(result.ok).toBe(true);
  });
});

describe("what it refuses or rejects, freezing nothing", () => {
  it("returns TRANSLATION_STALE, naming the language, when a translation was made from other English than the draft's", async () => {
    const prepare = setup(async ({ english }) => ({ translations: wholeSet(english, { ta: { status: "ok", source_hash: sha("Earlier English.") } }) }));

    expect(await prepare.prepare(contentOf(), context())).toEqual({ ok: false, error: "TRANSLATION_STALE", lang: "ta" });
  });

  it("returns SMS_BODY_TOO_LONG, naming the language, when a text message body is over the provider's limit", async () => {
    const long = "x".repeat(SMS_MAX_BODY_LENGTH);
    const prepare = setup(async ({ english }) => ({ translations: wholeSet(english).map((text) => (text.lang === "bn" ? { ...text, body: long } : text)) }));

    expect(await prepare.prepare(contentOf(), context())).toEqual({ ok: false, error: "SMS_BODY_TOO_LONG", lang: "bn" });
  });

  it("rejects, and does not freeze a half result, for a set that is not whole", async () => {
    const prepare = setup(async ({ english }) => ({ translations: wholeSet(english).slice(1) }));

    await expect(prepare.prepare(contentOf(), context())).rejects.toThrow(/missing translations/);
  });

  it("lets the translator's rejections through: the routes unavailable", async () => {
    const translate = vi.fn(async () => {
      throw new AlertRoutesUnavailableError();
    });

    await expect(setup(translate).prepare(contentOf(), context())).rejects.toBeInstanceOf(AlertRoutesUnavailableError);
  });
});
