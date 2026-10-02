import { describe, expect, it } from "vitest";
import {
  formatSeedReport,
  planSeed,
  sourceHash,
  type ContentInput,
  type GuideSource,
  type TranslationRecord,
} from "./guideContent";

const WHEN_911 = "Call 911 if someone is in danger.";

function guide(id: string, change: Partial<GuideSource> = {}): GuideSource {
  return {
    id,
    owner: "Ana Reyes",
    lastUpdated: "2026-10-02",
    englishReview: { reviewer: "Ana Reyes", date: "2026-10-03" },
    readMins: 3,
    title: `Title of ${id}`,
    when911: WHEN_911,
    before: ["Keep a flashlight."],
    during: ["Use a flashlight."],
    after: ["Plug things back in."],
    ...change,
  };
}

function input(change: Partial<ContentInput> = {}): ContentInput {
  return {
    guides: [guide("power"), guide("flood")],
    numbers: {
      owner: "Ana Reyes",
      lastUpdated: "2026-10-02",
      englishReview: { reviewer: "Ana Reyes", date: "2026-10-03" },
      numbers: [
        { id: "911", number: "911", emergency: true, label: "Emergency", when: "Call 911 right now.", lastChecked: "2026-10-03" },
        { id: "hub", number: "(416) 421-8997", label: "Talk to someone at the Hub", lastChecked: "2026-10-03" },
      ],
    },
    translations: {},
    ...change,
  };
}

const reviewed = (english: string, text: string, change: Partial<TranslationRecord> = {}): TranslationRecord => ({
  source: english,
  sourceHash: sourceHash(english),
  text,
  model: "command-a-translate-08-2025",
  status: "reviewed",
  reviewer: "Wei Chen",
  reviewedOn: "2026-11-02",
  ...change,
});

const withZh = (key: string, english: string, record: TranslationRecord | null): Partial<ContentInput> => ({
  translations: { zh: { language: "zh", texts: { [key]: record } } },
});

describe("sourceHash", () => {
  it("is the SHA-256 of the UTF-8 English, as scripts/content_catalogue.py computes it", () => {
    expect(sourceHash("Power outage")).toBe("fe236fdaa58da311940b886915cf57c5c674bf82a7de9ea01b9cb5cb624f3a1b");
    expect(sourceHash("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("attribution rules", () => {
  it("loads a guide and the numbers list that name an owner, a date and an English review by the owner", () => {
    const plan = planSeed(input());

    expect(plan.refusals).toEqual([]);
    expect(plan.guides.map((g) => g.id)).toEqual(["power", "flood"]);
    expect(plan.numbers.map((n) => n.id)).toEqual(["911", "hub"]);
    expect(plan.guides[0]).toMatchObject({ owner: "Ana Reyes", englishReviewer: "Ana Reyes", englishReviewedOn: "2026-10-03" });
    expect(plan.guides[0].texts["before.0"]).toEqual({ en: "Keep a flashlight." });
  });

  it.each([
    ["no owner", { owner: null }, "no owner is named"],
    ["a placeholder owner", { owner: "PLACEHOLDER: to be named" }, "the owner is still a placeholder"],
    ["no last-updated date", { lastUpdated: null }, "no valid last-updated date"],
    ["an impossible last-updated date", { lastUpdated: "2026-02-31" }, "no valid last-updated date"],
    ["no English review", { englishReview: null }, "no English review is recorded"],
    ["no reviewer", { englishReview: { reviewer: "", date: "2026-10-03" } }, "the English review has no reviewer"],
    ["a placeholder reviewer", { englishReview: { reviewer: "placeholder: later", date: "2026-10-03" } }, "the English reviewer is still a placeholder"],
    ["no review date", { englishReview: { reviewer: "Ana Reyes", date: null } }, "the English review has no valid date"],
    ["a review by someone else", { englishReview: { reviewer: "Sam Lee", date: "2026-10-03" } }, "the English review was not completed by the owner"],
  ] as [string, Partial<GuideSource>, string][])("refuses that guide, and only that guide, for %s", (_, change, reason) => {
    const plan = planSeed(input({ guides: [guide("power", change), guide("flood")] }));

    expect(plan.guides.map((g) => g.id)).toEqual(["flood"]);
    expect(plan.report.guides.find((g) => g.id === "power")).toEqual({ id: "power", loaded: false, reasons: [reason] });
    expect(plan.refusals).toEqual([]);
  });

  it("refuses a guide with an empty section", () => {
    const plan = planSeed(input({ guides: [guide("power", { during: [] })] }));

    expect(plan.guides).toEqual([]);
    expect(plan.report.guides[0].reasons).toEqual(["the title, or a before, during or after section, is empty"]);
  });

  it("refuses the whole numbers list when one number has no last-checked date", () => {
    const base = input();
    base.numbers.numbers[1].lastChecked = null;

    const plan = planSeed(base);

    expect(plan.numbers).toEqual([]);
    expect(plan.report.numbers).toEqual({ loaded: false, reasons: ["number hub has no valid last-checked date"] });
    expect(plan.guides).toHaveLength(2);
  });

  it.each([
    ["owner", { owner: "PLACEHOLDER: owner" }],
    ["English review", { englishReview: { reviewer: "Ana Reyes", date: null } }],
    ["last-updated date", { lastUpdated: undefined }],
  ])("refuses the numbers list for a missing %s", (_, change) => {
    const base = input();
    Object.assign(base.numbers, change);

    const plan = planSeed(base);

    expect(plan.numbers).toEqual([]);
    expect(plan.report.numbers.loaded).toBe(false);
    expect(plan.report.numbers.reasons.length).toBeGreaterThan(0);
  });
});

describe("translations", () => {
  const KEY = "guide.power.title";
  const english = "Title of power";

  it("loads a reviewed, current translation with its provenance", () => {
    const plan = planSeed(input(withZh(KEY, english, reviewed(english, "停电"))));

    expect(plan.guides[0].texts.title).toEqual({ en: english, zh: "停电" });
    expect(plan.guides[0].translations.title.zh).toMatchObject({ status: "reviewed", reviewer: "Wei Chen", reviewedOn: "2026-11-02", sourceHash: sourceHash(english) });
    expect(plan.report.translations.loaded).toBe(1);
  });

  it("does not load a machine translation: English with translation.unavailable, and the report says why", () => {
    const plan = planSeed(input(withZh(KEY, english, reviewed(english, "停电", { status: "machine", reviewer: null, reviewedOn: null }))));

    expect(plan.guides[0].texts.title).toEqual({ en: english });
    expect(plan.report.translations.unavailable).toContainEqual({ key: KEY, lang: "zh", reason: "machine" });
  });

  it("does not load a stale translation: the English changed since it was translated", () => {
    const plan = planSeed(input(withZh(KEY, english, reviewed("Old title of power", "旧停电"))));

    expect(plan.guides[0].texts.title).toEqual({ en: english });
    expect(plan.report.translations.unavailable).toContainEqual({ key: KEY, lang: "zh", reason: "stale" });
    expect(formatSeedReport(plan.report).join("\n")).toContain("zh guide.power.title: stale: the English changed since it was translated");
  });

  it("does not load a reviewed translation that names no reviewer or date", () => {
    const noReviewer = planSeed(input(withZh(KEY, english, reviewed(english, "停电", { reviewer: null }))));
    const noDate = planSeed(input(withZh(KEY, english, reviewed(english, "停电", { reviewedOn: "soon" }))));

    for (const plan of [noReviewer, noDate]) {
      expect(plan.guides[0].texts.title).toEqual({ en: english });
      expect(plan.report.translations.unavailable).toContainEqual({ key: KEY, lang: "zh", reason: "review_incomplete" });
    }
  });

  it("counts a null entry as English with translation.unavailable", () => {
    const plan = planSeed(input(withZh(KEY, english, null)));

    expect(plan.guides[0].texts.title).toEqual({ en: english });
    expect(plan.report.translations.unavailable).toContainEqual({ key: KEY, lang: "zh", reason: "not_translated" });
    expect(plan.refusals).toEqual([]);
  });

  describe("zh-Hant, converted from zh", () => {
    const conversion = { from: "zh", openccVersion: "1.4.2", config: "cn to twp" };
    const hant = (zhText: string, change: Partial<TranslationRecord> = {}) =>
      reviewed(english, "停電", { model: "opencc", conversion: { ...conversion, fromTextHash: sourceHash(zhText) }, ...change });
    const files = (zh: TranslationRecord | null, zhHant: TranslationRecord | null): Partial<ContentInput> => ({
      translations: { zh: { texts: { [KEY]: zh } }, "zh-Hant": { texts: { [KEY]: zhHant } } },
    });

    it("loads when the zh it came from is current, reviewed and unchanged", () => {
      const plan = planSeed(input(files(reviewed(english, "停电"), hant("停电"))));

      expect(plan.guides[0].texts.title["zh-Hant"]).toBe("停電");
      expect(plan.guides[0].translations.title["zh-Hant"].conversion).toMatchObject(conversion);
    });

    it.each([
      ["the zh text changed after the conversion", reviewed(english, "停电了"), hant("停电")],
      ["zh is not reviewed", reviewed(english, "停电", { status: "machine" }), hant("停电")],
      ["zh is stale", reviewed("Old", "停电"), hant("停电")],
      ["zh is missing", null, hant("停电")],
    ])("does not load when %s", (_, zh, zhHant) => {
      const plan = planSeed(input(files(zh, zhHant)));

      expect(plan.guides[0].texts.title["zh-Hant"]).toBeUndefined();
      expect(plan.report.translations.unavailable).toContainEqual({ key: KEY, lang: "zh-Hant", reason: "zh_changed_or_not_reviewed" });
    });

    it("does not load a conversion that records no OpenCC version or configuration", () => {
      const bare = hant("停电", { conversion: { from: "zh", fromTextHash: sourceHash("停电") } });
      const plan = planSeed(input(files(reviewed(english, "停电"), bare)));

      expect(plan.guides[0].texts.title["zh-Hant"]).toBeUndefined();
      expect(plan.report.translations.unavailable).toContainEqual({ key: KEY, lang: "zh-Hant", reason: "incomplete_record" });
    });
  });
});

describe("911 rules", () => {
  it("refuses the run when the 911 number is missing or is not 911", () => {
    const missing = input();
    missing.numbers.numbers = missing.numbers.numbers.filter((n) => n.id !== "911");
    const wrong = input();
    wrong.numbers.numbers[0].number = "9111";
    const blank = input();
    blank.numbers.numbers[0].number = null;

    expect(planSeed(missing).refusals).toEqual(["numbers.json has no 911 number"]);
    expect(planSeed(wrong).refusals).toEqual(['the 911 number is "9111", not 911']);
    expect(planSeed(blank).refusals).toEqual(['the 911 number is "", not 911']);
  });

  it("refuses the run when a 911 text is empty in English", () => {
    const noWhen = input();
    noWhen.numbers.numbers[0].when = " ";
    const noGuideWhen = input({ guides: [guide("power", { when911: null })] });

    expect(planSeed(noWhen).refusals).toEqual(["number.911.when (the 911 text) is empty in English"]);
    expect(planSeed(noGuideWhen).refusals).toEqual(['guide.power.when911 ("when to call 911") is empty in English']);
  });

  it("refuses the run when a translation of a 911 text is present but blank, in any language", () => {
    for (const lang of ["ur", "zh-Hant"] as const) {
      const blank: TranslationRecord = { ...reviewed(WHEN_911, "x"), text: "  " };
      const plan = planSeed(input({ translations: { [lang]: { texts: { "guide.power.when911": blank } } } }));

      expect(plan.refusals).toEqual([`guide.power.when911 is blank in ${lang}: a 911 text can never be empty in any language`]);
    }
  });

  it("does not load a translation of a 911 text that lost 911", () => {
    const plan = planSeed(input({ translations: { ur: { texts: { "guide.power.when911": reviewed(WHEN_911, "خطرے میں ہیں تو فون کریں") } } } }));

    expect(plan.guides[0].texts.when911).toEqual({ en: WHEN_911 });
    expect(plan.report.translations.unavailable).toContainEqual({ key: "guide.power.when911", lang: "ur", reason: "lost_911" });
  });

  it("resolves a null 911 text to the English in every language", () => {
    const plan = planSeed(input());

    expect(plan.refusals).toEqual([]);
    expect(plan.guides[0].texts.when911).toEqual({ en: WHEN_911 });
    expect(plan.numbers[0]).toMatchObject({ number: "911", emergency: true });
    expect(plan.numbers[0].texts.when).toEqual({ en: "Call 911 right now." });
  });
});

describe("report", () => {
  it("lists refusals and groups the texts that are not translated yet by language", () => {
    const lines = formatSeedReport(planSeed(input({ guides: [guide("power", { owner: null }), guide("flood")] })).report);

    expect(lines[0]).toBe("Guides loaded: 1 of 2 (flood)");
    expect(lines).toContain("  REFUSED guide power: no owner is named");
    expect(lines.some((l) => l.startsWith("Not translated yet (English with translation.unavailable):") && l.includes("ur 8"))).toBe(true);
  });
});
