import { describe, expect, it } from "vitest";
import type { Audience } from "../../../contracts/audience";
import { LAUNCH_CODES } from "../../../i18n/languages";
import { sha256Hex } from "../../../platform/hash";
import { SMS_MAX_BODY_LENGTH, countSms } from "../../messaging";
import { ALERT_TEXT_MAX, type EntryContent } from "../domain/content";
import { contentHash } from "../domain/hash";
import { freezeContent, type FreezeInput } from "./freezeContent";
import type { FrozenTranslation } from "../domain/translations";

const AUDIENCE: Audience = { scope: "buildings", buildings: [{ rsn: "4154146", floors: null }], groups: [], types: ["power"] };
const TEXT = "Power is out on floors 4 to 6. Toronto Hydro is on site.";
// A translation carries the SHA-256 of the English it was made from, and a freeze refuses one made from other English.
const SOURCE_HASH = sha256Hex(TEXT);

const content = (over: Partial<EntryContent> = {}): EntryContent => ({
  text: TEXT,
  types: ["power"],
  audience: AUDIENCE,
  phase: "problem",
  validUntil: new Date("2026-10-03T18:00:00Z"),
  ...over,
});

const translation = (lang: string, over: Partial<FrozenTranslation> = {}): FrozenTranslation => ({
  lang,
  body: `[${lang}] ${TEXT}`,
  machine: true,
  model: "command-a-translate-08-2025",
  status: "translated",
  sourceHash: SOURCE_HASH,
  ...over,
});

const input = (over: Partial<FreezeInput> = {}): FreezeInput => ({
  alertId: "01900000-0000-7000-8000-0000000000a1",
  kind: "ack",
  supersedesId: null,
  isDrill: false,
  channels: ["sms", "web"],
  content: content(),
  translations: [translation("ur"), translation("fr", { status: "fallback_en", machine: false, model: null, body: TEXT }), translation("zh-Hant", { status: "script_converted", model: null })],
  verified: true,
  attribution: { role: "hub" },
  slug: "k3x9a2",
  publicBaseUrl: "https://cvh.example",
  ...over,
});

function frozen(over: Partial<FreezeInput> = {}) {
  const result = freezeContent(input(over));
  if (!result.ok) throw new Error(`expected a frozen content, got ${result.error} (${result.lang})`);
  return result.value;
}

describe("freezeContent", () => {
  it("renders every launch language once, counts each body, and hashes it all", () => {
    const value = frozen();

    expect(Object.keys(value.smsBodies).sort()).toEqual([...LAUNCH_CODES].sort());
    for (const [lang, sms] of Object.entries(value.smsBodies)) {
      expect(sms.segments, lang).toBeGreaterThan(0);
      expect(countSms(sms.body), lang).toMatchObject({ encoding: sms.encoding, segments: sms.segments });
      expect(Object.keys(sms).sort(), lang).toEqual(["body", "encoding", "segments"]);
    }
    expect(value.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(value.translations).toEqual(input().translations);
  });

  it("freezes what the lifecycle's submit requires: a SHA-256, an English body, and the translations", () => {
    const value = frozen();

    expect(value.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect("en" in value.smsBodies).toBe(true);
    expect(value.translations.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(value.smsBodies))).toEqual(value.smsBodies); // storable as the jsonb column
  });

  it("puts the machine translation and its label in a translated language, and the English text with translation.unavailable in a fallback", () => {
    const value = frozen();

    expect(value.smsBodies.ur.body).toContain("[ur] Power is out");
    expect(value.smsBodies.fr.body).toContain(TEXT);
    expect(value.smsBodies.fr.body).toContain("Pas encore offert dans cette langue");
    expect(value.smsBodies.pa.body).toContain(TEXT); // no translation at all: the same fallback
    expect(value.smsBodies.en.body).toContain(TEXT);
  });

  it("gives the same content hash for the same input, however the translations are ordered", () => {
    const a = frozen();
    const b = frozen({ translations: [...input().translations].reverse() });

    expect(b.contentHash).toBe(a.contentHash);
    expect(frozen().contentHash).toBe(a.contentHash);
  });

  it("hashes the bodies and the web texts it froze, so the hash is the one hash.ts computes for them", () => {
    const value = frozen();
    const expected = contentHash({
      kind: "ack",
      alertId: input().alertId,
      supersedesId: null,
      types: ["power"],
      phase: "problem",
      audience: AUDIENCE,
      channels: ["sms", "web"],
      isDrill: false,
      validUntil: new Date("2026-10-03T18:00:00Z"),
      text: TEXT,
      smsBodies: value.smsBodies,
      webTexts: input().translations,
    });

    expect(value.contentHash).toBe(expected);
  });

  const changes: [string, Partial<FreezeInput>][] = [
    ["the kind", { kind: "update" }],
    ["the alert", { alertId: "01900000-0000-7000-8000-0000000000a2" }],
    ["the entry it corrects", { kind: "correction", supersedesId: "01900000-0000-7000-8000-0000000000b1" }],
    ["a drill", { isDrill: true }],
    ["the channels", { channels: ["web"] }],
    // The translations are of the new English too: a freeze of translations made from other English is refused (below).
    ["the text", { content: content({ text: `${TEXT} Stay away.` }), translations: input().translations.map((t) => ({ ...t, sourceHash: sha256Hex(`${TEXT} Stay away.`) })) }],
    ["the types", { content: content({ types: ["fire"], audience: { ...AUDIENCE, types: ["fire"] } }) }],
    ["the phase", { content: content({ phase: "in_progress" }) }],
    ["valid until", { content: content({ validUntil: new Date("2026-10-03T19:00:00Z") }) }],
    ["a translation", { translations: [translation("ur", { body: "different" })] }],
    ["the verification", { verified: false }],
    ["the attribution", { attribution: { role: "ambassador", building: "10 Thorncliffe Park Dr" } }],
    ["the slug", { slug: "z9y8x7" }],
    ["the public origin", { publicBaseUrl: "https://other.example" }],
  ];

  it.each(changes)("a change to %s changes the hash (what the approver approves is what is frozen)", (_, change) => {
    expect(frozen(change).contentHash).not.toBe(frozen().contentHash);
  });

  it("marks a drill and a correction in the bodies of every language, and puts the 911 line first for fire", () => {
    const value = frozen({ isDrill: true, kind: "correction", supersedesId: "01900000-0000-7000-8000-0000000000b1", content: content({ types: ["fire"], audience: { ...AUDIENCE, types: ["fire"] } }) });
    const [first, second, third] = value.smsBodies.en.body.split("\n");

    expect([first, second]).toEqual(["Exercise. Practice only.", "Correction"]);
    expect(third).toBe("The Hub is not an emergency service. If someone is in danger, call 911.");
    for (const lang of LAUNCH_CODES) expect(value.smsBodies[lang].body.split("\n").length, lang).toBeGreaterThanOrEqual(8);
  });

  it("builds the link from the public origin it is given", () => {
    expect(frozen().smsBodies.en.body).toContain("More: https://cvh.example/a/k3x9a2");
    expect(frozen({ publicBaseUrl: "http://localhost:3000" }).smsBodies.en.body).toContain("More: http://localhost:3000/a/k3x9a2");
  });

  it("refuses to freeze a text the provider would refuse (over 1600 characters), and names the language", () => {
    const result = freezeContent(input({ translations: [translation("ta", { body: "அ".repeat(SMS_MAX_BODY_LENGTH) })] }));

    expect(result).toEqual({ ok: false, error: "SMS_BODY_TOO_LONG", lang: "ta" });
  });

  it("never refuses a full-length English text in any language's fallback: the footer leaves room under 1600 characters", () => {
    const long = "x".repeat(ALERT_TEXT_MAX);
    const value = frozen({ content: content({ text: long }), translations: [] });

    for (const lang of LAUNCH_CODES) expect(value.smsBodies[lang].body.length, lang).toBeLessThanOrEqual(SMS_MAX_BODY_LENGTH);
  });

  describe("a translation made from other English than the draft is refused, whatever its status", () => {
    const OLD_TEXT = "Power is out on floors 4 to 5.";

    it.each([
      ["a machine translation", translation("ur", { sourceHash: sha256Hex(OLD_TEXT) }), "ur"],
      ["a fallback", translation("fr", { status: "fallback_en", machine: false, model: null, body: OLD_TEXT, sourceHash: sha256Hex(OLD_TEXT) }), "fr"],
      ["a script conversion", translation("zh-Hant", { status: "script_converted", model: null, sourceHash: sha256Hex(OLD_TEXT) }), "zh-Hant"],
    ])("%s of the text before the author's last edit: TRANSLATION_STALE, naming only the language", (_, stale, lang) => {
      const result = freezeContent(input({ translations: [translation("ps"), stale] }));

      expect(result).toEqual({ ok: false, error: "TRANSLATION_STALE", lang });
      expect(JSON.stringify(result)).not.toContain(TEXT);
      expect(JSON.stringify(result)).not.toContain(OLD_TEXT);
    });

    it("refuses a set one of whose translations is stale, though the rest are current, and a hash that is not a hash", () => {
      expect(freezeContent(input({ translations: [translation("ur"), translation("ps", { sourceHash: sha256Hex(OLD_TEXT) }), translation("ta")] }))).toEqual({ ok: false, error: "TRANSLATION_STALE", lang: "ps" });
      expect(freezeContent(input({ translations: [translation("ur", { sourceHash: "" })] }))).toEqual({ ok: false, error: "TRANSLATION_STALE", lang: "ur" });
    });

    it("hashes the raw text as the author wrote it: a translation of the same words with other spacing is stale, not current", () => {
      const result = freezeContent(input({ content: content({ text: ` ${TEXT}` }) }));

      expect(result).toMatchObject({ ok: false, error: "TRANSLATION_STALE" });
    });

    it("accepts a set made from the English being frozen, and a freeze with no translations at all", () => {
      expect(freezeContent(input({ translations: [translation("ur"), translation("ps")] })).ok).toBe(true);
      expect(freezeContent(input({ translations: [] })).ok).toBe(true);
    });
  });

  it("throws for a slug or origin that is not one, rather than freezing a broken link", () => {
    expect(() => freezeContent(input({ slug: "not a slug" }))).toThrow(RangeError);
    expect(() => freezeContent(input({ publicBaseUrl: "cvh.example" }))).toThrow(RangeError);
  });
});
