// The daily subscriber measures job and the Hub's reading of them (S07.10, FR-M1 subscribers). The job runs once a day (pg_cron, the job secret) and stores
// counts only: receiving subscribers by state, pending sign-ups, and the day's confirmations and deletions, by language and neighbourhood. It records the
// Toronto day that has just ended (by the database's clock; the figures are taken at the run, in the early morning), so running it again the same day replaces
// that day's figures instead of adding a second set. Nothing here reads or keeps a number, an id or a name.
import type { Db, DbExecutor } from "../../../platform/db";
import { subscriberMeasureStore } from "../adapters/subscriberMeasureStore";
import { readingsOf, type MeasuredDay, type SubscriberMeasuresDay } from "../domain/subscriberMeasures";

export interface SubscriberMeasuresReport {
  /** The Toronto day recorded, YYYY-MM-DD. */
  day: string;
  /** Cells written (languages x neighbourhoods x measures). */
  cells: number;
}

export interface SubscriberMeasuresJob {
  /** Records the Toronto day that has just ended (`yesterday`, the default), or the day still running (`today`). Idempotent for a day. */
  run(options?: { day?: MeasuredDay }): Promise<SubscriberMeasuresReport>;
}

export function createSubscriberMeasuresJob(deps: { db: Db }): SubscriberMeasuresJob {
  return {
    async run(options = {}) {
      return deps.db.transaction((tx) => subscriberMeasureStore.record(tx, options.day ?? "yesterday"));
    },
  };
}

/** The most recent recorded day, split by language and neighbourhood with the small-number rule applied; null when the job has never run. */
export async function readSubscriberMeasures(executor: DbExecutor, day?: string): Promise<SubscriberMeasuresDay | null> {
  const chosen = day ?? (await subscriberMeasureStore.latestDay(executor));
  if (chosen === null) return null;
  return { day: chosen, measures: readingsOf(await subscriberMeasureStore.day(executor, chosen)) };
}
