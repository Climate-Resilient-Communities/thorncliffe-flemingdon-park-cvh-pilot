import { describe, expect, it } from "vitest";
import { PROBLEM_MEANINGS, PROBLEM_STATES, PROGRESS_COUNT_KEYS, RESEND_LIMIT, UNRECEIVABLE_MEANINGS, progressOf, type EntryProgress, type ProblemText } from "@/modules/messaging";
import { englishText } from "@/i18n/text";
import { formatTorontoDateTime } from "@/platform/clock";
import { COUNT_ORDER, PROBLEM_ORDER, REFRESH_SECONDS, RESEND_MOST, UNRECEIVABLE_MEANING_IDS, languageLabel, meaningText, problemListView, sendingProgressView } from "./view";

const REF = { alertId: "01900000-0000-7000-8000-00000000a1e7", entryId: "01900000-0000-7000-8000-00000000e177" };

type Row = Parameters<typeof progressOf>[0][number];
const rows = (lang: string, state: Row["state"], n: number, handedOff = false): Row[] => Array.from({ length: n }, () => ({ lang, state, handedOff }));

const mixed: EntryProgress = progressOf([
  ...rows("en", "queued", 2),
  ...rows("en", "claimed", 1, true),
  ...rows("en", "submitted", 3, true),
  ...rows("en", "delivered", 10, true),
  ...rows("ur", "delivered", 4, true),
  ...rows("ur", "undelivered", 1, true),
  ...rows("ur", "failed", 2),
  ...rows("ur", "unknown", 1, true),
  ...rows("ur", "cancelled", 3),
]);

const view = (progress: EntryProgress, paused = false) => sendingProgressView({ ref: REF, progress, paused });
const countOf = (language: ReturnType<typeof view>["languages"][number], id: string) => language.counts.find((count) => count.id === id)?.n;

describe("the sending progress view", () => {
  it("lists its counts and its lists in the order of the messaging module's own", () => {
    expect([...COUNT_ORDER]).toEqual([...PROGRESS_COUNT_KEYS]);
    expect([...PROBLEM_ORDER]).toEqual([...PROBLEM_STATES]);
  });

  it("shows per language the waiting, in flight, delivered, undelivered, failed, unknown and cancelled counts, in that order and in words", () => {
    const shown = view(mixed);
    expect(shown.languages.map((language) => language.label)).toEqual(["English", "Urdu"]);
    expect(shown.languages[0].counts.map((count) => count.text)).toEqual(["Waiting: 2", "In flight: 4", "Delivered: 10", "Undelivered: 0", "Failed: 0", "Unknown: 0", "Cancelled: 0"]);
    expect(shown.languages[1].counts.map((count) => count.text)).toEqual(["Waiting: 0", "In flight: 0", "Delivered: 4", "Undelivered: 1", "Failed: 2", "Unknown: 1", "Cancelled: 3"]);
    expect(shown.summary).toBe("27 texts in all");
  });

  it("counts a claimed text that was handed to the provider, and a submitted one, as in flight", () => {
    const shown = view(progressOf([...rows("en", "claimed", 2, true), ...rows("en", "claimed", 5, false), ...rows("en", "submitted", 1, true)]));
    expect(countOf(shown.languages[0], "inFlight")).toBe(3);
    expect(countOf(shown.languages[0], "waiting")).toBe(5);
  });

  it("adds a row for all the languages when there is more than one, and not when there is one", () => {
    expect(view(mixed).total).toMatchObject({ lang: "all", label: "All languages" });
    expect(countOf(view(mixed).total!, "delivered")).toBe(14);
    expect(view(progressOf(rows("en", "queued", 1))).total).toBeNull();
  });

  it("shows skipped texts only when there are some, in every row", () => {
    expect(view(mixed).languages[0].counts.map((count) => count.id)).not.toContain("skipped");
    const skipped = view(progressOf([...rows("en", "skipped", 1), ...rows("ur", "queued", 1)]));
    for (const language of [...skipped.languages, skipped.total!]) expect(language.counts.map((count) => count.id)).toContain("skipped");
    expect(skipped.legend.items).toHaveLength(8);
    expect(view(mixed).legend.items).toHaveLength(7);
  });

  it("says one text in the singular, and that there is nothing to send when there is no text", () => {
    expect(view(progressOf(rows("en", "queued", 1))).summary).toBe("1 text in all");
    const none = view(progressOf([]));
    expect(none.none).toBe("No texts have been made for this alert, so there is nothing to send.");
    expect(none.languages).toEqual([]);
    expect(view(mixed).none).toBeNull();
  });

  it("reloads every 15 seconds while a text waits or is in flight, and says so; when none is it says the page no longer updates by itself", () => {
    expect(REFRESH_SECONDS).toBe(15);
    expect(view(mixed).live).toBe(true);
    expect(view(mixed).refresh).toEqual({ seconds: 15, note: "This page updates every 15 seconds while texts are going out." });
    const done = view(progressOf([...rows("en", "delivered", 2, true), ...rows("en", "failed", 1)]));
    expect(done.live).toBe(false);
    expect(done.refresh.note).toMatch(/no longer updates by itself/);
    expect(view(progressOf([...rows("en", "claimed", 1, true)])).live).toBe(true);
    expect(view(progressOf([...rows("en", "queued", 1)])).live).toBe(true);
  });

  it("links the lists of the failed, undelivered and unknown texts, each with its count, and only the ones that have some", () => {
    const shown = view(mixed);
    expect(shown.problems?.links).toEqual([
      { state: "failed", n: 2, label: "See the failed texts (2)", href: `/staff/alerts/sending/texts?alert=${REF.alertId}&entry=${REF.entryId}&state=failed` },
      { state: "undelivered", n: 1, label: "See the undelivered texts (1)", href: `/staff/alerts/sending/texts?alert=${REF.alertId}&entry=${REF.entryId}&state=undelivered` },
      { state: "unknown", n: 1, label: "See the texts with an unknown outcome (1)", href: `/staff/alerts/sending/texts?alert=${REF.alertId}&entry=${REF.entryId}&state=unknown` },
    ]);
    expect(view(progressOf(rows("en", "delivered", 3, true))).problems).toBeNull();
  });

  describe("the sentence about texts already handed to the provider (S06.06's handedOffLine)", () => {
    const sentence = (progress: EntryProgress, paused: boolean) => view(progress, paused).handedOff;
    const withHandedOff = (n: number) => progressOf([...rows("en", "queued", 4), ...rows("en", "delivered", n, true)]);

    it("is shown while texts are paused and the entry still has texts waiting: for many, for one", () => {
      expect(sentence(withHandedOff(7), true)).toBe("7 texts were already handed to the provider and cannot be recalled");
      expect(sentence(withHandedOff(1), true)).toBe("1 text was already handed to the provider and cannot be recalled");
    });

    it("says nothing when none was handed over", () => {
      expect(sentence(withHandedOff(0), true)).toBeNull();
    });

    it("is not shown when texts are not paused", () => {
      expect(sentence(withHandedOff(7), false)).toBeNull();
      expect(sentence(withHandedOff(1), false)).toBeNull();
    });

    it("is not shown when nothing of the entry is waiting, paused or not", () => {
      const sent = progressOf([...rows("en", "delivered", 3, true), ...rows("en", "failed", 1)]);
      expect(sentence(sent, true)).toBeNull();
    });

    it("counts the entry's rows with a hand-off whatever their state: delivered, failed after hand-off, in flight and unknown", () => {
      const progress = progressOf([
        ...rows("en", "queued", 2),
        ...rows("en", "claimed", 1, true),
        ...rows("en", "submitted", 1, true),
        ...rows("en", "delivered", 1, true),
        ...rows("en", "undelivered", 1, true),
        ...rows("en", "unknown", 1, true),
        ...rows("en", "failed", 1, true),
        ...rows("en", "failed", 1),
      ]);
      expect(sentence(progress, true)).toBe("6 texts were already handed to the provider and cannot be recalled");
    });

    it("is the pause screen's own wording, from the same catalog keys", () => {
      expect(englishText("staff.texts.paused.handedOff", { n: 7 })).toBe(sentence(withHandedOff(7), true));
      expect(englishText("staff.texts.paused.handedOffOne")).toBe(sentence(withHandedOff(1), true));
    });
  });
});

describe("the names of languages", () => {
  it("is English, or the composer's name for it", () => {
    expect(languageLabel("en")).toBe("English");
    expect(languageLabel("ur")).toBe("Urdu");
    expect(languageLabel("zh-Hant")).toMatch(/Chinese/);
  });
});

describe("the list of the texts that did not arrive", () => {
  const at = new Date("2026-10-05T18:15:00Z");
  const text = (over: Partial<ProblemText> & Pick<ProblemText, "state" | "meaning">): ProblemText => ({ id: "01900000-0000-7000-8000-00000abc1234", reference: "abc123", lang: "ur", code: null, at, resendN: null, resends: 0, resent: false, ...over });

  it("gives each text its reference, language and time, and what it means in plain words, without a number", () => {
    const list = problemListView({
      ref: REF,
      state: "failed",
      texts: [text({ state: "failed", meaning: "not_in_service" }), text({ id: "01900000-0000-7000-8000-00000abc5678", reference: "abc567", state: "failed", meaning: "other_code", code: 31999, lang: "en" })],
      more: false,
      limit: 200,
    });
    expect(list.title).toBe("Failed texts");
    expect(list.items.map((item) => item.meaning)).toEqual(["Number not in service", "The provider reported error 31999"]);
    expect(list.items[0].line).toBe(`Text abc123 · Urdu · ${formatTorontoDateTime(at)}`);
    expect(list.items.map((item) => `${item.line} ${item.meaning}`).join(" ")).not.toMatch(/\+\d|\d{3}[\s-]\d{3}[\s-]\d{4}|\d{10}/);
    expect(list.none).toBeNull();
    expect(list.more).toBeNull();
    expect(list.back).toEqual({ href: `/staff/alerts/sending?alert=${REF.alertId}&entry=${REF.entryId}`, label: "Back to sending progress" });
  });

  it("says an unknown outcome is unclear and was not re-sent", () => {
    const list = problemListView({ ref: REF, state: "unknown", texts: [text({ state: "unknown", meaning: "unclear" })], more: false, limit: 200 });
    expect(list.items[0].meaning).toBe("Outcome unclear; not re-sent");
    expect(list.title).toBe("Texts with an unknown outcome");
  });

  it("says when no text is in the state and when only the most recent are shown", () => {
    expect(problemListView({ ref: REF, state: "undelivered", texts: [], more: false, limit: 200 }).none).toBe("No text is in this state.");
    expect(problemListView({ ref: REF, state: "undelivered", texts: [text({ state: "undelivered", meaning: "blocked" })], more: true, limit: 200 }).more).toBe("Only the 200 most recent texts are shown.");
  });

  it("has a sentence in the catalog for every meaning the module can answer, and none that quotes a number", () => {
    for (const meaning of PROBLEM_MEANINGS) {
      const sentence = meaningText(meaning, meaning === "other_code" ? 30999 : null);
      expect(sentence, meaning).not.toMatch(/^staff\./);
      expect(sentence.length, meaning).toBeGreaterThan(5);
      expect(sentence, meaning).not.toMatch(/\{/);
    }
  });
});

describe("the Admin's resend on the list of the texts that did not arrive (S09.02)", () => {
  const at = new Date("2026-10-05T18:15:00Z");
  const text = (over: Partial<ProblemText> & Pick<ProblemText, "state" | "meaning">): ProblemText => ({ id: "01900000-0000-7000-8000-00000abc1234", reference: "abc123", lang: "ur", code: null, at, resendN: null, resends: 0, resent: false, ...over });
  const list = (texts: ProblemText[], over: Partial<Parameters<typeof problemListView>[0]> = {}) => problemListView({ ref: REF, state: "failed", texts, more: false, limit: 200, canResend: true, resendLanguages: ["ur"], ...over });

  it("agrees with the module on the numbers that cannot receive texts and on the limit of two", () => {
    expect([...UNRECEIVABLE_MEANING_IDS]).toEqual([...UNRECEIVABLE_MEANINGS]);
    expect(RESEND_MOST).toBe(RESEND_LIMIT);
  });

  it("draws nothing for anyone who is not an Admin", () => {
    const shown = list([text({ state: "failed", meaning: "no_reason" })], { canResend: false });
    expect(shown.items[0].resend).toBeNull();
    expect(shown.resendAll).toEqual([]);
    expect(shown.resendIntro).toBeNull();
  });

  it("gives an Admin a Resend on each text, carrying the entry, the text and the status they saw", () => {
    const shown = list([text({ state: "failed", meaning: "no_reason" })]);
    expect(shown.items[0].resend).toEqual({
      entryId: REF.entryId,
      deliveryId: "01900000-0000-7000-8000-00000abc1234",
      seen: "failed",
      label: "Resend",
      ariaLabel: "Resend text abc123",
      sending: "Resending",
      confirm: null,
    });
    expect(shown.resendIntro).toMatchObject({ title: "Resend texts" });
  });

  it("puts the warning on a text with an unknown outcome, and no bulk button on its list", () => {
    const shown = list([text({ state: "unknown", meaning: "unclear" })], { state: "unknown" });
    expect(shown.items[0].resend).toMatchObject({ seen: "unknown", confirm: "This text may already have arrived; resending may send it twice" });
    expect(shown.resendAll).toEqual([]);
    expect(shown.resendIntro).not.toBeNull();
  });

  it("offers one button for each language that has a text to resend, with the language named", () => {
    const shown = list([text({ state: "failed", meaning: "no_reason" })], { resendLanguages: ["en", "zh-Hant"] });
    expect(shown.resendAll.map((form) => [form.lang, form.entryId, form.label])).toEqual([
      ["en", REF.entryId, "Resend the failed and undelivered texts in English"],
      ["zh-Hant", REF.entryId, expect.stringMatching(/^Resend the failed and undelivered texts in .*Chinese/)],
    ]);
    expect(shown.resendAll[0].hint).toContain("Texts with an unknown outcome are never included");
  });

  it("offers no Resend on a text that cannot be resent, and says why in a note", () => {
    const shown = list([
      text({ id: "01900000-0000-7000-8000-00000abc0001", state: "failed", meaning: "invalid_number" }),
      text({ id: "01900000-0000-7000-8000-00000abc0002", state: "failed", meaning: "no_reason", resent: true, resends: 1 }),
      text({ id: "01900000-0000-7000-8000-00000abc0003", state: "failed", meaning: "no_reason", resendN: 2, resends: 2 }),
      text({ id: "01900000-0000-7000-8000-00000abc0004", state: "failed", meaning: "no_reason", resendN: 1, resends: 1 }),
    ]);
    expect(shown.items.map((item) => item.resend !== null)).toEqual([false, false, false, true]);
    expect(shown.items.map((item) => item.note)).toEqual([
      "Cannot be resent: the number cannot receive texts.",
      "Already resent: a newer text was made for this one.",
      "Resent twice already, which is the most.",
      "Resend 1 of 2.",
    ]);
  });

  it("shows no phone number in anything it says", () => {
    const shown = list([text({ state: "unknown", meaning: "unclear" })], { state: "unknown" });
    expect(JSON.stringify(shown)).not.toMatch(/\+\d|\d{3}[\s-]\d{3}[\s-]\d{4}|\d{10}/);
  });
});
