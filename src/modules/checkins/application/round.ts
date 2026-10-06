// What "My round" (S08.07, A-04) reads of the check-in rows: the live rows of the open rounds, and where a row a mark names is. The app composes the page
// from them (src/app/staff/ambassador/round/load.ts): who may see which floor (the role policy on the person's current assignments), the threads' words
// (alerting) and the phone numbers (subscriptions). Nothing here holds a number, and the subscriber's id never leaves the server.
import type { DbExecutor } from "../../../platform/db";
import { floorsOfBuilding } from "../../places";
import { markStore, type LiveRoundRow, type MarkStore } from "../adapters/markStore";

/** The live rows (they name their subscriber and are not tallied), oldest first. */
export function liveRoundRows(executor: DbExecutor, store: MarkStore = markStore): Promise<LiveRoundRow[]> {
  return store.liveRows(executor);
}

/**
 * A row's floor as the role policy judges it: the floor when it is still one of its building's floors (places'), else null. A floor an Admin removed
 * since the request was made leaves the row's `floor_id` as it was (no foreign key, S08.05): the request then counts as one on an uncovered floor, as
 * identity's `coversFloor` says, so no Ambassador covers it, even one assigned the whole building; an Admin still sees and marks it.
 */
export async function listedFloorOf(executor: DbExecutor, rsn: string, floorId: string): Promise<string | null> {
  const floors = await floorsOfBuilding(executor, rsn);
  return floors?.some((floor) => floor.id === floorId) ? floorId : null;
}

/**
 * Where the row a mark names is (its building, and its floor as `listedFloorOf` judges it), read without a lock: the staff guard's facts for
 * `checkins.mark`. Null when no row has that `round_ref` (never was, or purged): the policy then refuses an Ambassador, and the use case refuses anyone.
 */
export async function roundRowPlace(executor: DbExecutor, roundRef: string, store: MarkStore = markStore): Promise<{ rsn: string; floorId: string | null } | null> {
  const place = await store.placeOf(executor, roundRef);
  return place === null ? null : { rsn: place.rsn, floorId: await listedFloorOf(executor, place.rsn, place.floorId) };
}
