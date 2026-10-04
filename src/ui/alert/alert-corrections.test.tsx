// A corrected or withdrawn entry on R-07, the home card and the share preview (S05.02): the correction is shown above the entry it replaces, which stays readable and is
// marked "Corrected"; a withdrawn entry is marked "Withdrawn" and shows the reason (the withdrawal's own words) in its place; the withdrawal notice is not an entry of its own;
// what is true now (the card, the alert's words, the verification and the share preview) is the latest entry that was neither corrected nor withdrawn, so all of them say
// the same.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeedThreadSchema } from "@/contracts/feed";
import { AlertCard } from "./alert-card";
import { AlertDetail } from "./alert-detail";
import { alertView } from "./alert-view";
import { ID, SERVER_NOW, englishEntry, thread, translatorFor } from "./alert-test-helpers";

const en = translatorFor("en");
const T = (iso: string) => `2026-10-01T${iso}:00.000Z`;

const ORIGINAL = "Power is out on floors 1 to 6.";
const CORRECTED = "Power is out on floors 1 to 8, not floors 1 to 6.";
const REASON = "This alert had wrong information. It has been withdrawn.";

const ack = englishEntry({ n: 1, kind: "ack", published_at: T("14:00"), text: { lang: "en", body: ORIGINAL, machine: false, model: null, status: "source", source_hash: "a".repeat(64) }, original: { lang: "en", body: ORIGINAL } });
const update = englishEntry({ n: 2, kind: "update", phase: "in_progress", published_at: T("14:20"), text: { lang: "en", body: "Work is under way.", machine: false, model: null, status: "source", source_hash: "a".repeat(64) }, original: { lang: "en", body: "Work is under way." } });
const correction = (n: number, supersedes: string, minutes: string, body = CORRECTED) =>
  englishEntry({ n, kind: "correction", supersedes_id: supersedes, published_at: T(minutes), text: { lang: "en", body, machine: false, model: null, status: "source", source_hash: "a".repeat(64) }, original: { lang: "en", body } });
const withdrawal = (n: number, supersedes: string, minutes: string) => {
  const notice = englishEntry({ n, kind: "withdrawal", supersedes_id: supersedes, published_at: T(minutes), text: { lang: "en", body: REASON, machine: false, model: null, status: "source", source_hash: "a".repeat(64) }, original: { lang: "en", body: REASON } });
  // A withdrawal has no phase (the feed gives one only to an acknowledgement, an update and a correction).
  delete notice.phase;
  return notice;
};

const view = (entries: ReturnType<typeof englishEntry>[], lang: "en" | "ur" | "fr" = "en") => alertView(thread({ entries }), { lang, serverNow: SERVER_NOW, t: translatorFor(lang) });
const detail = (entries: ReturnType<typeof englishEntry>[]) => {
  const v = view(entries);
  return renderToStaticMarkup(<AlertDetail view={v} lang="en" t={en} />);
};

describe("a corrected entry", () => {
  const entries = [ack, correction(2, ID(1), "14:30")];

  it("is shown below its correction, with its own words unchanged and the mark \"Corrected\" with the time of the correction", () => {
    const v = view(entries);
    expect(v.entries.map((e) => [e.id, e.kind, e.mark])).toEqual([
      [ID(2), "correction", null],
      [ID(1), "ack", { kind: "corrected", label: "Corrected 30 minutes ago" }],
    ]);
    expect(v.entries[1].text.body).toBe(ORIGINAL);
    expect(v.entries[0].kindLabel).toBe("Correction");
  });

  it("makes the correction what is true now: the alert's words, its card and the share preview are the correction's, never the wording it replaced", () => {
    const v = view(entries);
    expect(v.current.id).toBe(ID(2));
    expect(v.current.text.body).toBe(CORRECTED);
    expect(v.preview.title).toBe("Elevator");
    expect(v.preview.description.endsWith(` — Correction: ${CORRECTED}`)).toBe(true);
    expect(v.preview.description).not.toContain(ORIGINAL);
    const card = renderToStaticMarkup(<AlertCard view={v} lang="en" t={en} />);
    expect(card).toContain(CORRECTED);
    expect(card).not.toContain(ORIGINAL);
  });

  it("is drawn in the thread: the correction first, then the original marked and still readable, each in its place", () => {
    const html = detail(entries);
    expect(html.indexOf(`data-testid="alert-entry-${ID(2)}"`)).toBeLessThan(html.indexOf(`data-testid="alert-entry-${ID(1)}"`));
    expect(html).toMatch(new RegExp(`data-testid="alert-entry-${ID(1)}" data-mark="corrected"`));
    expect(html).toContain(`data-testid="alert-entry-mark-${ID(1)}"`);
    expect(html).toContain("Corrected 30 minutes ago");
    expect(html).toContain(`data-testid="alert-entry-text-${ID(1)}">${ORIGINAL}</p>`);
    // The correction itself is not marked.
    expect(html).not.toContain(`data-testid="alert-entry-mark-${ID(2)}"`);
    expect(html).toContain("alert-ico--corrected");
  });

  it("can itself be corrected: the chain reads newest first, every replaced one marked", () => {
    const v = view([ack, correction(2, ID(1), "14:30"), correction(3, ID(2), "14:40", "Power is out on floors 1 to 8 and the lobby.")]);
    expect(v.entries.map((e) => [e.id, e.mark?.kind ?? null])).toEqual([[ID(3), null], [ID(2), "corrected"], [ID(1), "corrected"]]);
    expect(v.current.id).toBe(ID(3));
  });
});

describe("a withdrawn entry", () => {
  const entries = [ack, update, withdrawal(3, ID(2), "14:45")];

  it("is marked \"Withdrawn\" and shows the reason in the place of its words; the withdrawal notice is not an entry of its own", () => {
    const v = view(entries);
    expect(v.entries.map((e) => [e.id, e.mark?.label ?? null])).toEqual([[ID(2), "Withdrawn"], [ID(1), null]]);
    expect(v.entries[0].text.body).toBe(REASON);
    expect(v.entries[0].kind).toBe("update");
    expect(v.entries.some((e) => e.kind === "withdrawal")).toBe(false);
  });

  it("leaves what is true now to the entry that still stands, and the times to the entries residents read", () => {
    const v = view(entries);
    expect(v.current.id).toBe(ID(1));
    expect(v.current.text.body).toBe(ORIGINAL);
    expect(v.preview.description.endsWith(` — ${ORIGINAL}`)).toBe(true);
    expect(v.times).toBe("Posted 1 hour ago · Updated 40 minutes ago");
    // The card shows the standing acknowledgement, so it says when that was posted and not when the withdrawn update was.
    expect(v.cardTime).toBe("Posted 1 hour ago");
  });

  it("is drawn with the word and the reason, and the withdrawn wording is not shown as something to act on", () => {
    const html = detail(entries);
    expect(html).toMatch(new RegExp(`data-testid="alert-entry-${ID(2)}" data-mark="withdrawn"`));
    expect(html).toContain(`data-testid="alert-entry-mark-${ID(2)}"`);
    expect(html).toContain(">Withdrawn<");
    expect(html).toContain(`data-testid="alert-entry-text-${ID(2)}">${REASON}</p>`);
    expect(html).not.toContain("Work is under way.");
    // The notice is not drawn as a card of its own.
    expect(html).not.toContain(`data-testid="alert-entry-${ID(3)}"`);
  });

  it("marks the reason in the resident's language, in the attributes of its own text, when the withdrawal was translated", () => {
    const urdu = withdrawal(3, ID(2), "14:45");
    const translated = { ...urdu, text: { lang: "ur" as const, body: "یہ الرٹ واپس لے لیا گیا۔", machine: true, model: "m1", status: "ok" as const, source_hash: "a".repeat(64) }, original: { lang: "en" as const, body: REASON } };
    const v = view([ack, update, translated], "ur");
    expect(v.entries[0].mark?.label).toBe(translatorFor("ur")("R07.withdrawn"));
    expect(v.entries[0].text).toMatchObject({ body: "یہ الرٹ واپس لے لیا گیا۔", lang: "ur", dir: "rtl", machine: true });
    expect(v.entries[0].english).toBe(REASON);
  });
});

describe("the feed's contract", () => {
  it("accepts a correction and a withdrawal that name the entry they replace, with no field the phones in the field do not know", () => {
    const parsed = FeedThreadSchema.safeParse(thread({ entries: [ack, update, correction(3, ID(1), "14:30"), withdrawal(4, ID(2), "14:45")] }));
    expect(parsed.success).toBe(true);
    expect(Object.keys(withdrawal(4, ID(2), "14:45")).sort()).toEqual(["attribution", "id", "kind", "original", "published_at", "supersedes_id", "text", "verified"]);
  });
});

describe("an alert nothing was replaced in", () => {
  it("is as it was: the newest entry is what is true now, no mark anywhere, and the preview is its words", () => {
    const v = view([ack, update]);
    expect(v.current.id).toBe(ID(2));
    expect(v.entries.every((e) => e.mark === null)).toBe(true);
    expect(v.preview.description.endsWith(" — Work is under way.")).toBe(true);
    expect(detail([ack, update])).not.toContain("alert-mark");
  });
});
