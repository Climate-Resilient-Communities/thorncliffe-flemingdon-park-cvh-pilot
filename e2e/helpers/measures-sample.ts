import type { MeasuresView } from "../../src/app/staff/measures/view";
import { costView, measuresText, reachView, subscribersView, type Text } from "../../src/app/staff/measures/view";
import type { CorrectionReachReport, CorrectionReachRow } from "../../src/modules/messaging";
import type { AlertCost, AlertCostReport, AlertCostRow, CohereShare } from "../../src/modules/spend";
import { SUBSCRIBER_LANGS, SUBSCRIBER_MEASURES, type MeasureReading, type ShownCount, type SubscriberMeasuresDay } from "../../src/modules/subscriptions";

// The same sample as the pilot measures page shows for the layout tests and the screenshots (S07.10): counts, languages, amounts and the ids of alert entries.
// Nothing here is a phone number or a recipient: a count of 1 to 4 arrives as it does from the SQL views, hidden ("Fewer than 5").

const count = (n: number | null): ShownCount => ({ n, shown: n === null ? "fewer than 5" : String(n) });

/** Every measure for every launch language, with some groups hidden by the small-number rule. */
export function sampleDay(): SubscriberMeasuresDay {
  const measures: MeasureReading[] = SUBSCRIBER_MEASURES.map((measure, index) => ({
    measure,
    total: count(640 - index * 90),
    byLanguage: SUBSCRIBER_LANGS.map((lang, at) => ({ lang, count: count(at % 4 === 3 ? null : at === 0 ? 300 - index * 20 : 12 + at * 3) })),
    byNeighbourhood: [
      { nbhd: "FP", count: count(260 - index * 30) },
      { nbhd: "TP", count: count(380 - index * 60) },
    ],
  }));
  return { day: "2026-10-04", measures };
}

const reachRow = (n: number, over: Partial<CorrectionReachRow> = {}): CorrectionReachRow => ({
  entryId: `01900000-0000-7000-8000-0000000000${String(n).padStart(2, "0")}`,
  alertId: "01900000-0000-7000-8000-0000000000a1",
  kind: "correction",
  approvedAt: new Date("2026-10-04T16:00:00Z"),
  originalRecipients: count(120),
  attemptedReach: count(118),
  confirmedReach: count(104),
  attemptedPercent: 98,
  confirmedPercent: 86,
  ...over,
});

export function sampleReach(): CorrectionReachReport {
  return {
    real: [
      reachRow(1),
      reachRow(2, { kind: "withdrawal", originalRecipients: count(46), attemptedReach: count(46), confirmedReach: count(null), attemptedPercent: 100, confirmedPercent: null }),
      reachRow(3, { kind: "final", originalRecipients: count(312), attemptedReach: count(310), confirmedReach: count(287), attemptedPercent: 99, confirmedPercent: 91 }),
    ],
    drills: [reachRow(4, { originalRecipients: count(null), attemptedReach: count(null), confirmedReach: count(null), attemptedPercent: null, confirmedPercent: null })],
  };
}

const costRow = (lang: string | null, texts: number | null, millicents: number | null, basis: AlertCostRow["basis"]): AlertCostRow => ({
  lang,
  texts: count(texts),
  basis,
  countedMillicents: millicents,
  actualMillicents: basis === "actual" ? millicents : 0,
  estimateCents: basis === "estimate" && millicents !== null ? millicents / 1000 : 0,
});

export function sampleCost(): AlertCostReport {
  const entry = (n: number, over: Partial<AlertCost>): AlertCost => ({
    entryId: `01900000-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`,
    alertId: "01900000-0000-7000-8000-0000000000a1",
    kind: "ack",
    approvedAt: new Date("2026-10-04T16:00:00Z"),
    total: costRow(null, 312, 624_000, "mixed"),
    languages: [costRow("en", 180, 270_000, "actual"), costRow("ur", 96, 288_000, "estimate"), costRow("bn", null, null, null), costRow("hi", null, null, null)],
    ...over,
  });
  return {
    real: [entry(1, {}), entry(2, { kind: "correction", total: costRow(null, 120, 180_000, "estimate"), languages: [costRow("en", 120, 180_000, "estimate")] })],
    drills: [entry(3, { total: costRow(null, 2, null, null), languages: [costRow("en", null, null, null)] })],
  };
}

export function sampleCohere(): CohereShare[] {
  return [
    { month: "2026-10", allCalls: 140, alertCalls: 36, allTokens: 91_000, alertTokens: 24_500, alertTokenSharePercent: 26, tokensEstimated: true, allCostCents: null, alertCostCents: null },
    { month: "2026-09", allCalls: 80, alertCalls: 0, allTokens: 40_000, alertTokens: 0, alertTokenSharePercent: 0, tokensEstimated: false, allCostCents: 350, alertCostCents: 0 },
  ];
}

export type MeasuresSample = "director" | "coordinator" | "not-run" | "nothing";

/** The page's view model for a role and a state, with the words of `t` (the real ones, or the longest translated labels of a language). */
export function sampleView(sample: MeasuresSample, t: Text = measuresText): MeasuresView {
  const empty = sample === "nothing";
  return {
    title: t("title"),
    lead: t("lead"),
    privacy: t("privacy"),
    subscribers: subscribersView(sample === "not-run" ? null : sampleDay(), t),
    reach: reachView(empty ? { real: [], drills: [] } : sampleReach(), t),
    cost: sample === "coordinator" ? null : costView(empty ? { real: [], drills: [] } : sampleCost(), empty ? [] : sampleCohere(), t),
  };
}
