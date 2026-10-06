// What "My round" (S08.07, A-04) reads of the check-in rows: the live rows of the open rounds, and where a row a mark names is. The app composes the page
// from them (src/app/staff/ambassador/round/load.ts): who may see which floor (the role policy on the person's current assignments), the threads' words
// (alerting) and the phone numbers (subscriptions). Nothing here holds a number, and the subscriber's id never leaves the server.
import type { DbExecutor } from "../../../platform/db";
import { markStore, type LiveRoundRow, type MarkStore } from "../adapters/markStore";

/** The live rows (they name their subscriber and are not tallied), oldest first. */
export function liveRoundRows(executor: DbExecutor, store: MarkStore = markStore): Promise<LiveRoundRow[]> {
  return store.liveRows(executor);
}

/**
 * Where the row a mark names is (its building and floor), read without a lock: the staff guard's facts for `checkins.mark`. Null when no row has that
 * `round_ref` (never was, or purged): the policy then refuses an Ambassador, and the use case refuses anyone.
 */
export function roundRowPlace(executor: DbExecutor, roundRef: string, store: MarkStore = markStore): Promise<{ rsn: string; floorId: string } | null> {
  return store.placeOf(executor, roundRef);
}
