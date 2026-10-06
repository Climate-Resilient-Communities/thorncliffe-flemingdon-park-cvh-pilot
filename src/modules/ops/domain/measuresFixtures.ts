// Test fixtures for the pilot measures export (S09.05): one sample of every input the lines are made from, with a real alert, an alert sent for a rehearsal and a
// drill, and figures on both sides of the small-number rule. Counts, times, places and ids only. Used by tests only.
import type { MeasuresInput } from "./measureLines";

export const REAL = "0192f3a4-0000-7000-8000-00000000aaaa";
export const REAL_ENTRY = "0192f3a4-0000-7000-8000-0000000000a1";
export const REAL_CORRECTION = "0192f3a4-0000-7000-8000-0000000000a2";
export const REHEARSAL = "0192f3a4-0000-7000-8000-00000000bbbb";
export const REHEARSAL_ENTRY = "0192f3a4-0000-7000-8000-0000000000b1";
export const REHEARSAL_FINAL = "0192f3a4-0000-7000-8000-0000000000b2";
export const DRILL = "0192f3a4-0000-7000-8000-00000000cccc";
export const DRILL_ENTRY = "0192f3a4-0000-7000-8000-0000000000c1";

const at = (iso: string) => new Date(iso);
const shown = (n: number | null, text?: string) => ({ n, shown: text ?? (n === null ? "fewer than 5" : String(n)) });

/** Every input, as the views and ports would give it. */
export function sampleInput(): MeasuresInput {
  const approvals = [
    { entryId: REAL_ENTRY, alertId: REAL, kind: "ack", isDrill: false, approvedAt: at("2026-10-05T14:00:00Z"), firstSaveToApprovalMs: 240_000, reportedToFirstAckMs: 600_000 },
    { entryId: REAL_CORRECTION, alertId: REAL, kind: "correction", isDrill: false, approvedAt: at("2026-10-05T15:00:00Z"), firstSaveToApprovalMs: 120_000, reportedToFirstAckMs: null },
    { entryId: REHEARSAL_ENTRY, alertId: REHEARSAL, kind: "ack", isDrill: false, approvedAt: at("2026-10-01T14:00:00Z"), firstSaveToApprovalMs: 9_000_000, reportedToFirstAckMs: 9_000_000 },
    { entryId: DRILL_ENTRY, alertId: DRILL, kind: "ack", isDrill: true, approvedAt: at("2026-10-02T14:00:00Z"), firstSaveToApprovalMs: 60_000, reportedToFirstAckMs: 90_000 },
  ];
  const cost = (entryId: string, alertId: string) => ({
    entryId,
    alertId,
    kind: "ack",
    approvedAt: at("2026-10-05T14:00:00Z"),
    total: { lang: null, texts: shown(40), basis: "estimate", countedMillicents: 80_000 },
    languages: [
      { lang: "en", texts: shown(37), basis: "estimate", countedMillicents: 74_000 },
      { lang: "ur", texts: shown(null), basis: null, countedMillicents: null },
    ],
    cohere: [{ month: "2026-10", calls: 14, tokens: 20_000, tokenSharePercent: 31, tokensEstimated: false, costCents: null }],
  });
  return {
    subscribers: {
      day: "2026-10-05",
      measures: [{ measure: "receiving_active", total: shown(52), byLanguage: [{ lang: "en", count: shown(49) }, { lang: "ur", count: shown(null) }], byNeighbourhood: [{ nbhd: "TP", count: shown(52) }] }],
    },
    usage: [
      { weekStart: "2026-09-28", evt: "install", lang: "en", nbhd: "TP", n: 30 },
      { weekStart: "2026-09-28", evt: "install", lang: "ur", nbhd: "TP", n: 3 },
      { weekStart: "2026-09-28", evt: "install", lang: "fr", nbhd: "FP", n: 9 },
      { weekStart: "2026-09-21", evt: "map_view", lang: "en", nbhd: "", n: 2 },
    ],
    search: [
      { weekStart: "2026-09-28", lang: null, searches: 24, noClearMatch: 7, failed: 0, medianMs: 850 },
      { weekStart: "2026-09-28", lang: "en", searches: 20, noClearMatch: 6, failed: 0, medianMs: 800 },
      { weekStart: "2026-09-28", lang: "ur", searches: 4, noClearMatch: 1, failed: 0, medianMs: 1200 },
      { weekStart: null, lang: null, searches: 24, noClearMatch: 7, failed: 0, medianMs: 850 },
      { weekStart: null, lang: "en", searches: 20, noClearMatch: 6, failed: 0, medianMs: 800 },
      { weekStart: null, lang: "ur", searches: 4, noClearMatch: 1, failed: 0, medianMs: 1200 },
    ],
    approvals,
    deliveries: [
      { entryId: REAL_ENTRY, alertId: REAL, isDrill: false, handedOff: 40, delivered: 38, firstHandOffSeconds: 3, ninetyPercentSeconds: 95 },
      { entryId: REAL_CORRECTION, alertId: REAL, isDrill: false, handedOff: 20, delivered: 12, firstHandOffSeconds: 4, ninetyPercentSeconds: null },
      { entryId: REHEARSAL_ENTRY, alertId: REHEARSAL, isDrill: false, handedOff: 6, delivered: 6, firstHandOffSeconds: 2, ninetyPercentSeconds: 50 },
      { entryId: DRILL_ENTRY, alertId: DRILL, isDrill: true, handedOff: 3, delivered: 3, firstHandOffSeconds: 2, ninetyPercentSeconds: 30 },
    ],
    languageTimings: [
      { entryId: REAL_ENTRY, lang: "en", isDrill: false, handedOff: 37, ninetyPercentSeconds: 90 },
      { entryId: REAL_ENTRY, lang: "ur", isDrill: false, handedOff: 3, ninetyPercentSeconds: 40 },
      { entryId: REHEARSAL_ENTRY, lang: "fr", isDrill: false, handedOff: 6, ninetyPercentSeconds: 50 },
    ],
    checkins: [
      { alertId: REAL, closedAt: at("2026-10-05T20:00:00Z"), rsn: "1000001", nbhd: "TP", address: "1 Leaside Park Dr", floorId: "f1", floorLabel: "3", floorOrder: 3, status: "requested", n: 6 },
      { alertId: REAL, closedAt: at("2026-10-05T20:00:00Z"), rsn: "1000001", nbhd: "TP", address: "1 Leaside Park Dr", floorId: "f2", floorLabel: "4", floorOrder: 4, status: "requested", n: 2 },
      { alertId: REAL, closedAt: at("2026-10-05T20:00:00Z"), rsn: "1000001", nbhd: "TP", address: "1 Leaside Park Dr", floorId: "f1", floorLabel: "3", floorOrder: 3, status: "done", n: 6 },
      { alertId: REAL, closedAt: at("2026-10-05T20:00:00Z"), rsn: "1000001", nbhd: "TP", address: "1 Leaside Park Dr", floorId: "f2", floorLabel: "4", floorOrder: 4, status: "needs_help", n: 2 },
      { alertId: REHEARSAL, closedAt: at("2026-10-01T20:00:00Z"), rsn: "1000002", nbhd: "FP", address: "2 Grenoble Dr", floorId: "f9", floorLabel: "9", floorOrder: 9, status: "requested", n: 7 },
    ],
    translations: [
      ...Array.from({ length: 6 }, (_, index) => ({ entryId: `real-${index}`, alertId: REAL, isDrill: false, lang: "ur", fellBack: index === 0 })),
      ...Array.from({ length: 6 }, (_, index) => ({ entryId: `real-${index}`, alertId: REAL, isDrill: false, lang: "fr", fellBack: false })),
      { entryId: REHEARSAL_ENTRY, alertId: REHEARSAL, isDrill: false, lang: "ur", fellBack: true },
      { entryId: DRILL_ENTRY, alertId: DRILL, isDrill: true, lang: "ur", fellBack: false },
    ],
    survey: { byLanguage: [{ lang: "ur", asked: 12, understood: 9 }, { lang: "fr", asked: 3, understood: 3 }], from: "2026-10-01", to: "2026-10-04" },
    corrections: {
      real: [
        { entryId: REAL_CORRECTION, alertId: REAL, kind: "correction", approvedAt: at("2026-10-05T15:00:00Z"), originalRecipients: shown(40), attemptedReach: shown(20), confirmedReach: shown(12), attemptedPercent: 50, confirmedPercent: 30 },
        { entryId: REHEARSAL_FINAL, alertId: REHEARSAL, kind: "final", approvedAt: at("2026-10-01T15:00:00Z"), originalRecipients: shown(6), attemptedReach: shown(6), confirmedReach: shown(6), attemptedPercent: 100, confirmedPercent: 100 },
      ],
      drills: [],
    },
    drills: [{ alertId: DRILL, firstApprovedAt: at("2026-10-02T14:00:00Z"), entriesApproved: 4, handedOff: 12, delivered: 10, notDelivered: 2, unknown: 0, notSent: 0 }],
    cost: { real: [cost(REAL_ENTRY, REAL), cost(REHEARSAL_ENTRY, REHEARSAL)], drills: [], cohere: [{ month: "2026-10", allCalls: 40, alertCalls: 30, drillCalls: 4, alertTokenSharePercent: 70, drillTokenSharePercent: 9, tokensEstimated: true, allCostCents: null, alertCostCents: null, drillCostCents: null }] },
    spend: {
      month: "2026-10",
      budgetCents: 100_000,
      remainingCents: 98_766,
      capCents: null,
      pilot: {
        totalCents: 1_234,
        incomplete: true,
        sms: { countedCents: 1_234, actual: { cents: 1_000, texts: 400 }, unmatchedActuals: { cents: 0, texts: 0 }, unresolvedEstimates: { cents: 0, texts: 0 }, pendingMonths: [{ month: "2026-10", reason: "not_run", estimatedCents: 234, texts: 3 }] },
        cohere: { calls: 40, tokens: 50_000, tokensEstimated: false, priced: { calls: 0, cents: 0 }, unpriced: { calls: 40, tokens: 50_000, estimateCents: null } },
      },
      thisMonth: {
        totalCents: 234,
        incomplete: true,
        sms: { countedCents: 234, actual: { cents: 0, texts: 0 }, unmatchedActuals: { cents: 0, texts: 0 }, unresolvedEstimates: { cents: 0, texts: 0 }, pendingMonths: [{ month: "2026-10", reason: "not_run", estimatedCents: 234, texts: 3 }] },
        cohere: { calls: 40, tokens: 50_000, tokensEstimated: false, priced: { calls: 0, cents: 0 }, unpriced: { calls: 40, tokens: 50_000, estimateCents: null } },
      },
    },
    coverage: [
      { nbhd: "TP", name: "Thorncliffe Park", buildings: 20, buildingsCovered: 6, buildingsFullyCovered: 3, floors: 300, floorsCovered: 40 },
      { nbhd: "FP", name: "Flemingdon Park", buildings: 12, buildingsCovered: 2, buildingsFullyCovered: 0, floors: 150, floorsCovered: 9 },
    ],
  };
}
