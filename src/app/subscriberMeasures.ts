// Composition root of the daily subscriber measures job (S07.10, AD-2): subscriptions' job on the app's database. Server only. `/api/jobs/subscriber-measures`
// (pg_cron once a day, with the job secret) is the one caller; the Hub's measures page reads the figures with `readSubscriberMeasures`. The job stores counts
// only and reads no SMS or Twilio credential, so it works in every environment.
import "server-only";
import { createSubscriberMeasuresJob, type SubscriberMeasuresReport } from "@/modules/subscriptions";
import { getDb, type Db } from "@/platform/db";

/** One run of the job: records the Toronto day that has just ended, counts only. */
export function runSubscriberMeasuresJob(parts: { db?: Db } = {}): Promise<SubscriberMeasuresReport> {
  return createSubscriberMeasuresJob({ db: parts.db ?? getDb() }).run();
}
