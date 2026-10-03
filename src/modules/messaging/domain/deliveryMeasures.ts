// The pilot's delivery measures (S06.08, FR-M2, FR-M4): how quickly an alert's texts went out and arrived, and how far a correction reached.
// Pure: they are computed from what the outbox already records, with no new column, because the dispatcher and the callbacks already
// stamp the instants (`handed_off_at` is the database's `now()` at the hand-off, and `completed_at` is the database's `now()` at the
// moment a callback made the row `delivered`; the approval's instant is the entry's `approved_at`, which alerting owns and gives).
//
// **Time to deliver.** Per entry and language the denominator is the rows handed off to the provider (a row with `handed_off_at`, excluding
// `cancelled`, `skipped` and `skipped_env`: those were never sent). Reported: the time from approval to the first hand-off, and the time
// from approval to the moment the delivered rows reach 90% of that denominator. If 90% is never reached the measure says "not reached"
// and gives the final delivered share. The denominator is read as it stands when the measure is computed.
//
// **Correction reach.** Attempted reach is the original's recipients (everyone the original entry had a text for, whatever became of it:
// a correction goes to every recipient of the original, S06.03) and, of them, the recipients the correction's text was handed off to;
// confirmed reach is the recipients whose correction text is `delivered`. Counted in recipients, since a recipient has at most one text
// per entry. A text to a recipient who has since been deleted (no recipient id) cannot be matched and is not counted.
//
// **Drills apart.** A drill entry goes only to the drill roster (`roster` recipients) and a real one never does, so an entry's texts say
// whether it was a drill; every result carries `drill`, and `splitDrills` keeps the two kinds from being added together.
import type { DeliveryState } from "./deliveryState";

/** The delivered share the time-to-deliver measure waits for, as a percentage of the rows handed off. */
export const DELIVERED_SHARE_PERCENT = 90;

/** The states of a row that was never sent to the provider (or never could have been): not in the denominator. */
export const NEVER_SENT_STATES: readonly DeliveryState[] = ["cancelled", "skipped", "skipped_env"];

export interface MeasuredRow {
  lang: string;
  recipientKind: string;
  state: DeliveryState;
  handedOffAt: Date | null;
  /** The instant the row reached a terminal state: for a `delivered` row, the moment of the delivery callback. */
  completedAt: Date | null;
}

/** Whether a row was handed off to the provider: it is in the denominator of the delivery measures. */
export const wasHandedOff = (row: Pick<MeasuredRow, "state" | "handedOffAt">): boolean => row.handedOffAt !== null && !NEVER_SENT_STATES.includes(row.state);

/** The moment the delivered rows reached 90% of those handed off, as time since approval; or "not reached" with the delivered share at the end. */
export type DeliveredShareReading = { reached: true; afterApprovalMs: number } | { reached: false; deliveredShare: number };

export interface LanguageTiming {
  lang: string;
  /** The denominator: rows handed off. */
  handedOff: number;
  delivered: number;
  /** Time from approval to the first hand-off, in milliseconds. */
  firstHandOffAfterMs: number;
  /** Time from approval until the delivered rows reached 90% of the rows handed off. */
  ninetyPercentDelivered: DeliveredShareReading;
}

export interface EntryTimings {
  /** Whether the entry's texts went to the drill roster (a drill), which is reported apart. */
  drill: boolean;
  /** One reading per language that has a row handed off, in language order; a language with none has no measure (nothing was sent). */
  languages: LanguageTiming[];
}

const isDrillRow = (row: Pick<MeasuredRow, "recipientKind">) => row.recipientKind === "roster";

/** An entry's delivery timings, from its rows and the instant it was approved. */
export function entryTimings(rows: readonly MeasuredRow[], approvedAt: Date): EntryTimings {
  const byLanguage = new Map<string, MeasuredRow[]>();
  for (const row of rows) {
    if (!wasHandedOff(row)) continue;
    const list = byLanguage.get(row.lang) ?? [];
    list.push(row);
    byLanguage.set(row.lang, list);
  }
  const languages: LanguageTiming[] = [];
  for (const lang of [...byLanguage.keys()].sort()) {
    const handedOffRows = byLanguage.get(lang) ?? [];
    const handedOff = handedOffRows.length;
    const firstHandOff = Math.min(...handedOffRows.map((row) => row.handedOffAt?.getTime() ?? Number.POSITIVE_INFINITY));
    const deliveredAt = handedOffRows
      .filter((row) => row.state === "delivered" && row.completedAt !== null)
      .map((row) => row.completedAt?.getTime() ?? 0)
      .sort((a, b) => a - b);
    // The fewest delivered rows that make 90% of the denominator, in whole numbers: ceil(9 x handedOff / 10).
    const needed = Math.ceil((DELIVERED_SHARE_PERCENT * handedOff) / 100);
    languages.push({
      lang,
      handedOff,
      delivered: deliveredAt.length,
      firstHandOffAfterMs: firstHandOff - approvedAt.getTime(),
      ninetyPercentDelivered:
        deliveredAt.length >= needed ? { reached: true, afterApprovalMs: (deliveredAt[needed - 1] ?? 0) - approvedAt.getTime() } : { reached: false, deliveredShare: deliveredAt.length / handedOff },
    });
  }
  return { drill: rows.some(isDrillRow), languages };
}

export interface ReachRow {
  entryId: string;
  /** Null once the recipient was deleted. */
  recipientId: string | null;
  recipientKind: string;
  state: DeliveryState;
  handedOffAt: Date | null;
}

export interface CorrectionReach {
  drill: boolean;
  /** Recipients of the original entry. */
  originalRecipients: number;
  /** Of them, the recipients the correction's text was handed off to. */
  attemptedReach: number;
  /** Of them, the recipients whose correction text is `delivered`. */
  confirmedReach: number;
  /** Shares of the original's recipients; null when the original had none. */
  attemptedShare: number | null;
  confirmedShare: number | null;
}

/** How far a correction reached, against the recipients of the entry it corrects. */
export function correctionReach(rows: readonly ReachRow[], originalEntryId: string, correctionEntryId: string): CorrectionReach {
  const recipients = (predicate: (row: ReachRow) => boolean) =>
    new Set(rows.filter(predicate).flatMap((row) => (row.recipientId === null ? [] : [row.recipientId])));
  const original = recipients((row) => row.entryId === originalEntryId);
  const attempted = recipients((row) => row.entryId === correctionEntryId && wasHandedOff(row) && original.has(row.recipientId ?? ""));
  const confirmed = recipients((row) => row.entryId === correctionEntryId && row.state === "delivered" && original.has(row.recipientId ?? ""));
  return {
    drill: rows.some(isDrillRow),
    originalRecipients: original.size,
    attemptedReach: attempted.size,
    confirmedReach: confirmed.size,
    attemptedShare: original.size === 0 ? null : attempted.size / original.size,
    confirmedShare: original.size === 0 ? null : confirmed.size / original.size,
  };
}

/** Keeps drills apart from real alerts: whatever is measured, the two are never added together. */
export function splitDrills<T extends { drill: boolean }>(measured: readonly T[]): { real: T[]; drills: T[] } {
  return { real: measured.filter((item) => !item.drill), drills: measured.filter((item) => item.drill) };
}
