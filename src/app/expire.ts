// Composition root of the expire job (S05.04, AD-2): alerting's expirer on the app's database, with the catalog's words for the system final, the audit trail,
// messaging's outbox cancellation (inside the closing transaction) and ops' event log. Server only. `/api/jobs/expire` (pg_cron every minute, with the job
// secret) is the one caller. It reads no SMS or Twilio credential and works in every environment: the system final is web-only and queues no text.
import "server-only";
import { createAlertExpiry, type ExpireReport } from "@/modules/alerting";
import { englishText } from "@/i18n/text";
import { getDb, type Db } from "@/platform/db";

export interface ExpireParts {
  db?: Db;
  now?: () => Date;
}

/** One run of the expire job: closes every open thread past its valid-until, each in its own transaction, and reports counts. */
export function runExpireJob(parts: ExpireParts = {}): Promise<ExpireReport> {
  return createAlertExpiry({ db: parts.db ?? getDb(), finalText: () => englishText("staff.expire.finalText"), now: parts.now }).run();
}
