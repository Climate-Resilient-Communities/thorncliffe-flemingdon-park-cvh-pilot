// The message a resident shares (R-29, S05.08): its words, its order and the link are fixed here, for the standard version only. The message is composed from the alert's
// view and nothing about the sharer, so nothing tailored can be in it; an alert that is not verified says so; a corrected, withdrawn or closed alert says its state; times are clock
// times, never "5 minutes ago".
import { describe, expect, it } from "vitest";
import type { FeedThread } from "@/contracts/feed";
import type { LaunchCode } from "@/i18n/languages";
import { alertView } from "./alert-view";
import { SERVER_NOW, ENGLISH, URDU, englishEntry, entry, fallbackEntry, thread, translatorFor } from "./alert-test-helpers";
import { shareLink, shareMessage, whatsappHref } from "./share-message";

const BASE = "https://cvh.example.org";
const T = (iso: string) => `2026-10-01T${iso}:00.000Z`;
const words = (body: string) => ({ text: { lang: "en" as const, body, machine: false, model: null, status: "source" as const, source_hash: "a".repeat(64) }, original: { lang: "en" as const, body } });
// ICU may write a clock time with a narrow no-break space before AM and PM; the tests compare plain spaces.
const plain = (text: string) => text.replace(/[  ]/g, " ");

function message(t: FeedThread, lang: "en" | "ur" | "fr" = "en", place: string | null = "Thorncliffe Park") {
  const translate = translatorFor(lang);
  const view = alertView(t, { lang: lang as LaunchCode, serverNow: SERVER_NOW, t: translate, place });
  return shareMessage(view, { lang: lang as LaunchCode, serverNow: SERVER_NOW, t: translate, link: shareLink(BASE, view.slug, lang as LaunchCode) });
}

describe("the shared message of a verified alert", () => {
  const m = message(thread({ entries: [englishEntry()] }));

  it("is, in the prototype's order: what, who sent it, whether the Hub checked it, where, when, the 911 line and the link", () => {
    expect(m.lines.map(plain)).toEqual([
      `Elevator: ${ENGLISH}`,
      "Community alert from the Hub",
      "Verified by the Hub",
      "Thorncliffe Park",
      "Posted today at 10:40 AM",
      "Not an emergency service. In danger? Call 911.",
      `Newest updates and any corrections: ${BASE}/a/kbcdfghj?l=en`,
    ]);
    expect(m.text).toBe(m.lines.join("\n"));
  });

  it("carries the link to the standard alert in the language it was shared from: /a/{slug}?l={lang}", () => {
    expect(m.link).toBe(`${BASE}/a/kbcdfghj?l=en`);
    expect(message(thread({ entries: [entry()] }), "ur").link).toBe(`${BASE}/a/kbcdfghj?l=ur`);
  });

  it("offers WhatsApp the whole message, link included, as one encoded text", () => {
    expect(m.whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(m.text)}`);
    expect(whatsappHref("a b\n&c")).toBe("https://wa.me/?text=a%20b%0A%26c");
    expect(decodeURIComponent(m.whatsapp.split("text=")[1])).toBe(m.text);
  });

  it("says no time as 'ago', because it is read later", () => {
    expect(m.text).not.toMatch(/\bago\b/);
  });
});

describe("the shared message of an alert that is not verified", () => {
  it("says 'Not yet verified', as every surface does, and never 'Verified'", () => {
    const m = message(thread({ entries: [englishEntry({ verified: false })] }));

    expect(m.lines).toContain("Not yet verified");
    expect(m.text).not.toContain("Verified by");
  });
});

describe("the shared message in the page's language", () => {
  it("is the alert's translated words, the language's own marks and words, with the machine-translation label", () => {
    const m = message(thread({ entries: [entry()] }), "ur");

    expect(m.lines[0]).toBe(`لفٹ: ${URDU}`);
    expect(m.lines[1]).toBe("مشین سے ترجمہ");
    expect(m.text).toContain("تازہ ترین اپ ڈیٹس");
    expect(m.text).not.toMatch(/Posted|Verified|Community alert/);
  });

  it("says English stands in for a translation that failed, and carries the English", () => {
    const m = message(thread({ entries: [fallbackEntry()] }), "ur");

    expect(m.lines[0]).toBe(`لفٹ: ${ENGLISH}`);
    expect(m.lines[1]).toBe("ابھی اس زبان میں دستیاب نہیں");
  });
});

describe("the shared message of a corrected alert", () => {
  it("is the correction, marked as one, with the time of the update, and never the wording it replaced", () => {
    const original = englishEntry({ n: 1, published_at: T("14:00"), ...words("Power is out on floors 1 to 6.") });
    const correction = englishEntry({ n: 2, kind: "correction", supersedes_id: original.id, published_at: T("14:30"), ...words("Power is out on floors 1 to 8.") });
    const m = message(thread({ entries: [original, correction] }));

    expect(m.lines[0]).toBe("Elevator: Correction: Power is out on floors 1 to 8.");
    expect(m.text).not.toContain("floors 1 to 6");
    expect(m.lines.map(plain)).toContain("Posted today at 10:00 AM");
    expect(m.lines.map(plain)).toContain("Updated today at 10:30 AM");
  });
});

describe("the shared message of a thread that closed", () => {
  const ack = englishEntry({ n: 1, published_at: T("14:00"), ...words("Power is out on floors 1 to 6.") });

  it("says it was resolved with its clock time and the final message, and no 'posted' line", () => {
    const final = englishEntry({ n: 2, kind: "final", published_at: T("14:55"), ...words("Power is back on all floors.") });
    const m = message(thread({ state: "closed", close_reason: "resolved", entries: [ack, final] }));

    expect(m.lines[0]).toBe("Elevator: Power is back on all floors.");
    expect(m.lines.map(plain)).toContain("This alert has ended. It was resolved today at 10:55 AM.");
    expect(m.text).not.toContain("Posted");
  });

  it("says it expired without a final update", () => {
    const final = englishEntry({ n: 2, kind: "final", published_at: T("14:55"), ...words("This alert has ended without a final update.") });
    const m = message(thread({ state: "closed", close_reason: "expired", entries: [ack, final] }));

    expect(m.lines.map(plain)).toContain("This alert has ended. It expired today at 10:55 AM without a final update.");
    expect(m.text).not.toMatch(/resolved/i);
  });

  it("says it was withdrawn with the reason, and never the wording that was withdrawn", () => {
    const withdrawal = englishEntry({ n: 2, kind: "withdrawal", supersedes_id: ack.id, published_at: T("14:30"), ...words("This alert had wrong information. It has been withdrawn.") });
    delete withdrawal.phase;
    const m = message(thread({ state: "closed", close_reason: "withdrawn", entries: [ack, withdrawal] }));

    expect(m.lines[0]).toBe("Elevator: This alert had wrong information. It has been withdrawn.");
    expect(m.lines).toContain("The Hub withdrew this alert. This alert had wrong information. It has been withdrawn.");
    expect(m.text).not.toContain("floors 1 to 6");
  });
});

describe("the shared message and who shares it", () => {
  const audience = (groups: ("seniors" | "families")[]) => ({ scope: "buildings" as const, buildings: [{ rsn: "4154146", floors: null }], groups, types: ["elevator"] });

  it("is the standard version: an alert narrowed to a group reads the same as one for everyone, and nothing the phone knows of its owner can be in it", () => {
    const everyone = message(thread({ audience: audience([]), entries: [englishEntry()] }), "en", "4 Milepost Pl");
    const narrowed = message(thread({ audience: audience(["seniors"]), entries: [englishEntry()] }), "en", "4 Milepost Pl");

    expect(narrowed.text).toBe(everyone.text);
    // The tailored block's words (X-12) and the group are not in it.
    expect(everyone.text).not.toMatch(/seniors|for you|your building|tailored/i);
  });
});

describe("the link", () => {
  it("is /a/{slug}?l={lang} under the public origin, whatever trailing slashes the origin has", () => {
    expect(shareLink("https://cvh.example.org/", "kbcdfghj", "ps")).toBe("https://cvh.example.org/a/kbcdfghj?l=ps");
    expect(shareLink("https://cvh.example.org///", "abcdef12", "zh")).toBe("https://cvh.example.org/a/abcdef12?l=zh");
  });

  it("refuses something that is not a slug", () => {
    for (const slug of ["", "SHORT", "a/b", "ab cd ef", "../x", "toolongtoolongtoolong"]) expect(() => shareLink(BASE, slug, "en"), slug).toThrow(RangeError);
  });
});
