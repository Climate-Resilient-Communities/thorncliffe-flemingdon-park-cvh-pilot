import { describe, expect, it } from "vitest";
import { dialNumber, guideView, numbersView, orderGuides, shownText, type GuideRecord, type NumberRecord } from "./residentContent";

const guide = (texts: GuideRecord["texts"], id = "power"): GuideRecord => ({ id, readMins: 3, lastUpdated: "2026-09-30", texts });

const POWER: GuideRecord["texts"] = {
  title: { en: "Power outage", ur: "بجلی کی بندش" },
  when911: { en: "Call 911 if someone is in danger.", ur: "اگر کسی کو خطرہ ہو تو 911 پر کال کریں۔" },
  "before.0": { en: "Keep a flashlight." },
  "before.1": { en: "Charge a battery pack." },
  "before.10": { en: "Tenth line." },
  "during.0": { en: "Use a flashlight, not candles.", ur: "ٹارچ استعمال کریں۔" },
  "after.0": { en: "Check your food." },
};

describe("shownText", () => {
  it("shows the translation when the seed loaded one", () => {
    expect(shownText(POWER, "title", "ur")).toEqual({ text: "بجلی کی بندش", lang: "ur", unavailable: false });
  });

  it("shows the checked English with translation.unavailable when the language has none", () => {
    expect(shownText(POWER, "before.0", "ur")).toEqual({ text: "Keep a flashlight.", lang: "en", unavailable: true });
    expect(shownText(POWER, "title", "fr")).toEqual({ text: "Power outage", lang: "en", unavailable: true });
  });

  it("is plain English, not unavailable, for English", () => {
    expect(shownText(POWER, "title", "en")).toEqual({ text: "Power outage", lang: "en", unavailable: false });
  });

  it("treats a blank translation as missing, never as a blank text", () => {
    expect(shownText({ a: { en: "Hello", ur: "  " } }, "a", "ur")).toEqual({ text: "Hello", lang: "en", unavailable: true });
  });

  it("is null for a key that does not exist", () => {
    expect(shownText(POWER, "nope", "en")).toBeNull();
  });
});

describe("guideView", () => {
  it("lays out before, during and after in order, with numeric (not text) ordering of the lines", () => {
    const view = guideView(guide(POWER), "en")!;

    expect(view.sections.before.map((line) => line.text)).toEqual(["Keep a flashlight.", "Charge a battery pack.", "Tenth line."]);
    expect(view.sections.during).toHaveLength(1);
    expect(view.sections.after).toHaveLength(1);
    expect(view.anyUnavailable).toBe(false);
    expect(view.lastUpdated).toBe("2026-09-30");
    expect(view.readMins).toBe(3);
  });

  it("says which texts are English standing in, and whether that is all of them", () => {
    const partly = guideView(guide(POWER), "ur")!;
    expect(partly.anyUnavailable).toBe(true);
    expect(partly.allUnavailable).toBe(false);
    expect(partly.title.unavailable).toBe(false);
    expect(partly.sections.during[0].unavailable).toBe(false);
    expect(partly.sections.before[0].unavailable).toBe(true);

    const none = guideView(guide(POWER), "fr")!;
    expect(none.allUnavailable).toBe(true);
    expect(none.when911.lang).toBe("en");
  });

  it("is null when the row has no title or no 911 text", () => {
    const noTitle = { ...POWER };
    delete noTitle.title;
    expect(guideView(guide(noTitle), "en")).toBeNull();
    const noWhen = { ...POWER };
    delete noWhen.when911;
    expect(guideView(guide(noWhen), "en")).toBeNull();
  });
});

describe("orderGuides", () => {
  it("puts the six guides in the prototype's order and any other after them", () => {
    const ids = ["fire", "zzz", "power", "smoke", "heat", "elevator", "flood", "aaa"].map((id) => ({ id }));
    expect(orderGuides(ids).map((g) => g.id)).toEqual(["power", "flood", "elevator", "heat", "smoke", "fire", "aaa", "zzz"]);
  });
});

describe("numbersView", () => {
  const record = (id: string, sortOrder: number, number: string, texts: NumberRecord["texts"], emergency = false, lastUpdated = "2026-09-30"): NumberRecord => ({
    id,
    sortOrder,
    number,
    emergency,
    lastUpdated,
    lastChecked: "2026-09-29",
    texts,
  });
  const rows = [
    record("hub", 4, "(416) 421-8997", { label: { en: "Talk to someone at the Hub" } }),
    record("911", 0, "911", { label: { en: "Emergency", ur: "ہنگامی" }, when: { en: "Call 911 now.", ur: "فوراً 911 پر کال کریں۔" } }, true),
    record("211", 1, "211", { label: { en: "Help finding services" } }),
    record("hydro", 3, "416-542-8000", { label: { en: "Toronto Hydro" } }),
    record("311", 2, "311", { label: { en: "City services" } }),
  ];

  it("shows 911 apart, then the others in the Hub's order", () => {
    const view = numbersView(rows, "en");

    expect(view.emergency?.id).toBe("911");
    expect(view.emergency?.when?.text).toBe("Call 911 now.");
    expect(view.others.map((n) => n.id)).toEqual(["211", "311", "hydro", "hub"]);
    expect(view.lastUpdated).toBe("2026-09-30");
  });

  it("gives each number a dial string: digits only, +1 in front of a ten-digit number", () => {
    const view = numbersView(rows, "en");
    expect(view.emergency?.dial).toBe("911");
    expect(Object.fromEntries(view.others.map((n) => [n.id, n.dial]))).toEqual({ "211": "211", "311": "311", hydro: "+14165428000", hub: "+14164218997" });
    expect(dialNumber("+1 (416) 555-0123")).toBe("+14165550123");
  });

  it("keeps 911's translation and falls back to English for the others", () => {
    const view = numbersView(rows, "ur");
    expect(view.emergency?.label).toEqual({ text: "ہنگامی", lang: "ur", unavailable: false });
    expect(view.others[0].label.unavailable).toBe(true);
    expect(view.anyUnavailable).toBe(true);
  });

  it("has no emergency row and no date for an empty list", () => {
    expect(numbersView([], "en")).toEqual({ emergency: null, others: [], lastUpdated: null, anyUnavailable: false });
  });

  it("dates the list by its latest update", () => {
    const view = numbersView(
      [record("911", 0, "911", { label: { en: "E" } }, true, "2026-09-01"), record("211", 1, "211", { label: { en: "H" } }, false, "2026-09-30")],
      "en",
    );
    expect(view.lastUpdated).toBe("2026-09-30");
  });
});
