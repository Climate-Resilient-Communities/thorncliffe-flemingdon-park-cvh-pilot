// The round tally as it is read back (S08.09; E08 definition "Round tally"). Pure: the counts are kept by the database's trigger on `checkin`
// (S08.05, and S08.09's row deleted before it was tallied), in the statement's own transaction; nothing here counts a row.

/** What a request ended as, one per row, recorded when it leaves its round: its latest mark, else `withdrawn` (it left before the close) or `unmarked`. */
export const TALLY_OUTCOMES = ["done", "not_reached", "needs_help", "withdrawn", "unmarked"] as const;
export type TallyOutcome = (typeof TALLY_OUTCOMES)[number];

/** The tally's statuses: the requests made at a place (cumulative, never taken back), then the outcomes. */
export const TALLY_STATUSES = ["requested", ...TALLY_OUTCOMES] as const;
export type TallyStatus = (typeof TALLY_STATUSES)[number];

/** One count of the tally: a thread's requests at one building and floor with one status. No identifier of anyone. */
export interface TallyCount {
  alertId: string;
  rsn: string;
  floorId: string;
  status: TallyStatus;
  n: number;
}

/** Every status's count at one place (0 where the tally has none). */
export type PlaceCounts = Record<TallyStatus, number>;

export const noCounts = (): PlaceCounts => ({ requested: 0, done: 0, not_reached: 0, needs_help: 0, withdrawn: 0, unmarked: 0 });

export const isTallyStatus = (status: string): status is TallyStatus => (TALLY_STATUSES as readonly string[]).includes(status);

/**
 * The requests at a place that have no outcome yet: the rows still in their round. Once the thread has closed every row has its outcome, so it is 0
 * there ("after close, for each location, `requested` equals the sum of the outcomes"); a negative number would mean a row was counted twice.
 */
export function stillInRound(counts: PlaceCounts): number {
  return counts.requested - TALLY_OUTCOMES.reduce((sum, outcome) => sum + counts[outcome], 0);
}

/** The counts of each place of a thread, in the order the places first appear. */
export function countsByPlace(counts: readonly TallyCount[]): { alertId: string; rsn: string; floorId: string; counts: PlaceCounts }[] {
  const places = new Map<string, { alertId: string; rsn: string; floorId: string; counts: PlaceCounts }>();
  for (const count of counts) {
    const key = `${count.alertId} ${count.rsn} ${count.floorId}`;
    const place = places.get(key) ?? { alertId: count.alertId, rsn: count.rsn, floorId: count.floorId, counts: noCounts() };
    place.counts[count.status] += count.n;
    places.set(key, place);
  }
  return [...places.values()];
}
