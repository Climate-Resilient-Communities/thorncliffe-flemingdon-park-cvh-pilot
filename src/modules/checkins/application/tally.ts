// What the Hub reads of the round tally (S08.09, O-17): a closed round's counts by building and floor, kept after its rows are gone (E08 "Round tally",
// "Closed stub"). The live counts of an open round are not read here: they come from the round's rows as they are now (`liveRoundRows`), since a row
// adds its outcome to the tally only when it leaves the round.
import type { DbExecutor } from "../../../platform/db";
import { tallyStore, type TallyStore } from "../adapters/tallyStore";
import type { TallyCount } from "../domain/tally";

/** The tally of these threads, by thread, building, floor and status. */
export function roundTallies(executor: DbExecutor, alertIds: readonly string[], store: TallyStore = tallyStore): Promise<TallyCount[]> {
  return store.ofThreads(executor, alertIds);
}
