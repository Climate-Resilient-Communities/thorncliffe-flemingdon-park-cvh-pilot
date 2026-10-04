// Composition root of the health job (S06.07, S09.01, AD-23): ops' job on the app's database, with messaging's reader of the sender's health and its
// outbox (the on-call texts are `transactional` deliveries, purpose `oncall_alert`) and directory's last successful publish. Server only. `/api/jobs/health` (pg_cron every minute, with the job
// secret) is the one caller. It reads no Twilio credential and works in every environment: outside production the texts it queues become
// `skipped_env` at the hand-off, like every other text.
import "server-only";
import { lastPublishedAt } from "@/modules/directory";
import { createDeliveryQueue, createSenderHealth, stdoutMessagingLog } from "@/modules/messaging";
import { createHealthJob, type HealthJob, type HealthReport } from "@/modules/ops";
import { getEnv } from "@/platform/config/env";
import { getDb, type Db } from "@/platform/db";

export interface HealthParts {
  db?: Db;
  pricePerSegmentCents?: () => number;
  transactionalDailyCeiling?: () => number;
  logError?: (evt: string, fields: Record<string, string>) => void;
}

/** The health job on the real database (every part can be replaced in a test). */
export function appHealthJob(parts: HealthParts = {}): HealthJob {
  const queue = createDeliveryQueue();
  return createHealthJob({
    db: parts.db ?? getDb(),
    sender: createSenderHealth(),
    enqueue: (tx, input) => queue.enqueueTransactional(tx, input),
    pricePerSegmentCents: parts.pricePerSegmentCents ?? (() => getEnv().smsPricePerSegmentCents),
    transactionalDailyCeiling: parts.transactionalDailyCeiling ?? (() => getEnv().smsTransactionalDailyCeiling),
    lastPublishedAt: (executor) => lastPublishedAt(executor),
    logError: parts.logError ?? ((evt, fields) => stdoutMessagingLog.error(evt, { module: "ops", ...fields })),
  });
}

/** One run of the health job: judges every condition, texts the on-call Admins where it must, records what it found and, if it judged all, the heartbeat. */
export function runHealthJob(parts: HealthParts = {}): Promise<HealthReport> {
  return appHealthJob(parts).run();
}
