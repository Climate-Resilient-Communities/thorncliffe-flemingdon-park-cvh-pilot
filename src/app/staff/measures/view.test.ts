import { describe, expect, it } from "vitest";
import type { CorrectionReachReport, CorrectionReachRow } from "@/modules/messaging";
import type { AlertCost, AlertCostReport, AlertCostRow, CohereShare } from "@/modules/spend";
import type { SubscriberMeasuresDay } from "@/modules/subscriptions";
import { centsText, costView, countText, dayText, millicentsText, reachView, subscribersView } from "./view";

const count = (n: number | null) => ({ n, shown: n === null ? "fewer than 5" : String(n) });

describe("counts as the Hub prints them", () => {
  it("prints a hidden count as 'Fewer than 5', zero as 0 and the rest as they are", () => {
    expect(countText(count(null))).toBe("Fewer than 5");
    expect(countText(count(0))).toBe("0");
    expect(countText(count(12))).toBe("12");
  });

  it("prints amounts in dollars with two to three decimals", () => {
    expect(millicentsText(44_000)).toBe("$0.44");
    expect(millicentsText(105)).toBe("$0.001");
    expect(millicentsText(10_500)).toBe("$0.105");
    expect(millicentsText(0)).toBe("$0.00");
    expect(centsText(350)).toBe("$3.50");
    expect(centsText(0.5)).toBe("$0.005");
  });

  it("prints a Toronto day in words", () => {
    expect(dayText("2026-10-04")).toBe("October 4, 2026");
  });
});

describe("the subscribers section", () => {
  const day: SubscriberMeasuresDay = {
    day: "2026-10-04",
    measures: [
      {
        measure: "receiving_active",
        total: count(62),
        byLanguage: [
          { lang: "en", count: count(40) },
          { lang: "ur", count: count(null) },
        ],
        byNeighbourhood: [
          { nbhd: "FP", count: count(22) },
          { nbhd: "TP", count: count(40) },
        ],
      },
    ],
  };

  it("names the day, each measure, the total and the splits, with hidden counts as 'Fewer than 5'", () => {
    const view = subscribersView(day);
    expect(view.lead).toBe("Counted by the daily job for October 4, 2026. People who signed up for texts, by language and neighbourhood.");
    expect(view.measures).toEqual([
      {
        id: "receiving_active",
        name: "Receiving texts",
        total: "All: 62",
        byLanguage: "By language: English: 40; Urdu: Fewer than 5",
        byNeighbourhood: "By neighbourhood: Flemingdon Park: 22; Thorncliffe Park: 40",
      },
    ]);
  });

  it("says the daily count has not run when there is nothing to show", () => {
    for (const none of [null, { day: "2026-10-04", measures: [] }]) {
      const view = subscribersView(none);
      expect(view.measures).toEqual([]);
      expect(view.lead).toContain("has not run yet");
    }
  });
});

describe("the reach section", () => {
  const row = (over: Partial<CorrectionReachRow> = {}): CorrectionReachRow => ({
    entryId: "01900000-0000-7000-8000-0000000000e1",
    alertId: "01900000-0000-7000-8000-0000000000a1",
    kind: "correction",
    approvedAt: new Date("2026-10-04T16:00:00Z"),
    originalRecipients: count(120),
    attemptedReach: count(118),
    confirmedReach: count(100),
    attemptedPercent: 98,
    confirmedPercent: 83,
    ...over,
  });
  const report = (real: CorrectionReachRow[], drills: CorrectionReachRow[] = []): CorrectionReachReport => ({ real, drills });

  it("prints attempted and confirmed reach against the original's recipients, with the percentages", () => {
    const view = reachView(report([row()]));
    expect(view.real).toEqual([
      {
        id: "01900000-0000-7000-8000-0000000000e1",
        title: "Correction, approved October 4, 2026",
        lines: ["Got the original: 120", "Attempted: 118", "Confirmed: 100", "Attempted 98% and confirmed 83% of those who got the original"],
      },
    ]);
  });

  it("prints a hidden figure as 'Fewer than 5' and says why there is no percentage", () => {
    const [entry] = reachView(report([row({ confirmedReach: count(null), confirmedPercent: null, kind: "final" })])).real;
    expect(entry?.title).toBe("Final, approved October 4, 2026");
    expect(entry?.lines).toEqual(["Got the original: 120", "Attempted: 118", "Confirmed: Fewer than 5", "No percentage: a figure is under 5"]);
  });

  it("keeps drills in a list of their own", () => {
    const view = reachView(report([], [row({ kind: "withdrawal" })]));
    expect(view.real).toEqual([]);
    expect(view.realEmpty).toBe("No correction, withdrawal or final has been texted yet.");
    expect(view.drills).toHaveLength(1);
    expect(view.drillsHeading).toBe("Drills, kept apart");
  });
});

describe("the cost section", () => {
  const cell = (over: Partial<AlertCostRow>): AlertCostRow => ({ lang: "en", texts: count(40), basis: "estimate", countedMillicents: 80_000, actualMillicents: 0, estimateCents: 80, ...over });
  const entry = (over: Partial<AlertCost> = {}): AlertCost => ({
    entryId: "01900000-0000-7000-8000-0000000000e2",
    alertId: "01900000-0000-7000-8000-0000000000a2",
    kind: "ack",
    approvedAt: new Date("2026-10-04T16:00:00Z"),
    total: cell({ lang: null, texts: count(55), countedMillicents: 120_500, basis: "mixed" }),
    languages: [cell({}), cell({ lang: "ur", texts: count(null), basis: null, countedMillicents: null, actualMillicents: null, estimateCents: null })],
    ...over,
  });
  const report = (real: AlertCost[], drills: AlertCost[] = []): AlertCostReport => ({ real, drills });
  const share = (over: Partial<CohereShare> = {}): CohereShare => ({
    month: "2026-10",
    allCalls: 40,
    alertCalls: 10,
    allTokens: 4000,
    alertTokens: 1000,
    alertTokenSharePercent: 25,
    tokensEstimated: false,
    allCostCents: null,
    alertCostCents: null,
    ...over,
  });

  it("prints the SMS cost by language, labelled actual, estimate or mixed, and no amount for fewer than 5 texts", () => {
    const view = costView(report([entry()]), []);
    expect(view.real[0]?.title).toBe("Acknowledgement, approved October 4, 2026");
    expect(view.real[0]?.lines).toEqual([
      "All languages: 55 texts. $1.205 CAD (part actual, part estimate)",
      "English: 40 texts. $0.80 CAD (estimate)",
      "Urdu: Fewer than 5 texts. No amount: fewer than 5 texts",
    ]);
  });

  it("keeps a drill's cost apart", () => {
    const view = costView(report([], [entry()]), []);
    expect(view.real).toEqual([]);
    expect(view.realEmpty).toBe("No alert has texts with a recorded cost yet.");
    expect(view.drills).toHaveLength(1);
  });

  it("prints the alerts' share of Cohere use, and an unknown price as unknown, never zero", () => {
    expect(costView(report([]), [share()]).cohere.lines).toEqual(["2026-10: alerts used 25% of the billed tokens (10 of 40 calls).", "Cost: unknown, because a price is not set."]);
    expect(costView(report([]), [share({ allCostCents: 350, alertCostCents: 87.5, tokensEstimated: true })]).cohere.lines).toEqual([
      "2026-10: alerts used 25% of the billed tokens (10 of 40 calls).",
      "Cost to alerts: $0.875 CAD. All use: $3.50 CAD.",
      "Some token counts are estimates.",
    ]);
    expect(costView(report([]), [share({ allTokens: 0, alertTokens: 0, alertTokenSharePercent: null })]).cohere.lines[0]).toBe("2026-10: no billed tokens yet (10 of 40 calls).");
    expect(costView(report([]), []).cohere.lines).toEqual([]);
  });
});
