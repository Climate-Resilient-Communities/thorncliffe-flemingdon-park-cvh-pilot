import { describe, expect, it } from "vitest";
import { LAUNCH_CODES } from "../../../i18n/languages";
import { RECONSENT_DAYS, campaignTexts, deadlineDateOf, deadlineForStaff, deadlineInText, estimateCampaign, isDeadlineDate, textCostCents } from "./campaign";

describe("the campaign's deadline (S09.07: the end of the Toronto day 30 days after the start)", () => {
  it("is 30 days after today in Toronto, whatever the hour in UTC", () => {
    expect(RECONSENT_DAYS).toBe(30);
    expect(deadlineDateOf(new Date("2026-11-05T15:00:00Z"))).toBe("2026-12-05");
    // 01:30 UTC on Nov 6 is still Nov 5 in Toronto.
    expect(deadlineDateOf(new Date("2026-11-06T01:30:00Z"))).toBe("2026-12-05");
    expect(deadlineDateOf(new Date("2026-12-20T12:00:00Z"))).toBe("2027-01-19");
  });

  it("is a real calendar day when the form carries it back", () => {
    expect(isDeadlineDate("2026-12-05")).toBe(true);
    for (const value of ["2026-02-31", "2026-12-5", "tomorrow", null, 20261205]) expect(isDeadlineDate(value), String(value)).toBe(false);
  });

  it("is written in each language's own way, on the Gregorian calendar, with no year; and for the Hub's staff in full", () => {
    expect(deadlineInText("2026-12-05", "en")).toBe("December 5");
    expect(deadlineInText("2026-12-05", "fr")).toBe("5 décembre");
    expect(deadlineInText("2026-12-05", "es")).toBe("5 de diciembre");
    // Dari and Pashto: December, not the Persian calendar's month.
    expect(deadlineInText("2026-12-05", "prs")).not.toMatch(/قوس|آذر/u);
    // The month abbreviated where the text fits one text message only that way.
    expect(deadlineInText("2026-09-28", "ta")).toBe("28 செப்.");
    expect(deadlineForStaff("2026-12-05")).toBe("Saturday, December 5, 2026");
  });
});

describe("the campaign's texts and their cost", () => {
  const texts = campaignTexts("2026-12-05", (lang, date) => ({ body: `${lang} ${date}`, segments: lang === "en" ? 1 : 2 }));

  it("are one per launch language, each with the deadline filled in", () => {
    expect(Object.keys(texts).sort()).toEqual([...LAUNCH_CODES].sort());
    expect(texts.en).toEqual({ body: "en December 5", segments: 1 });
  });

  it("estimate one text per subscriber in their language, each rounded up to whole cents as the outbox stores it", () => {
    expect(textCostCents(2, 1.5)).toBe(3);
    expect(textCostCents(1, 1.5)).toBe(2);
    expect(estimateCampaign({ en: 3, ur: 2, fr: 0 }, texts, 1.5)).toEqual({
      byLanguage: [
        { lang: "ur", subscribers: 2, costCents: 6 },
        { lang: "en", subscribers: 3, costCents: 6 },
      ],
      subscribers: 5,
      costCents: 12,
    });
    expect(estimateCampaign({}, texts, 1.5)).toEqual({ byLanguage: [], subscribers: 0, costCents: 0 });
  });
});
