// Composition root of the end-of-pilot purge (S09.08, AD-2): subscriptions' purge on the app's database, with what it may not import itself: the E07 deletion
// (the inbound router's `deleteSubscriber`, the steps STOP runs, with check-ins' port as the router has it), messaging's skip of a subscriber's waiting texts,
// and ops' event log for the one aggregate `campaign.purge_completed`. Server only. `/api/jobs/end-of-pilot-purge` (pg_cron every 15 minutes, with the job
// secret) is the one caller; the terms page reads the day it completed through src/app/pilotEnd.ts. It sends no text and reads no Twilio credential.
import "server-only";
import { createDeliveryQueue } from "@/modules/messaging";
import { recordOpsEvent } from "@/modules/ops";
import { createEndOfPilotPurge, type EndOfPilotPurge, type PurgeLog, type PurgeReport, type createInboundRouter } from "@/modules/subscriptions";
import { getDb, type Db } from "@/platform/db";
import { inboundRouter } from "./inbound";

/** A failed deletion's log line: one JSON line with the error's class only. */
const stdoutPurgeLog: PurgeLog = {
  error: (evt, fields) => console.log(JSON.stringify({ level: "error", evt, module: "subscriptions", ...fields })),
};

/** The purge on the given database (the app's by default). */
export function endOfPilotPurge(db: Db = getDb()): EndOfPilotPurge {
  const queue = createDeliveryQueue();
  return createEndOfPilotPurge({
    db,
    // The one deletion, as STOP runs it: the webhook's own router (so both delete with the same check-ins port), which `createInboundRouter` makes with its
    // `SubscriberDeletion`; `inboundRouter` declares only the webhook's half. (S09.03 and S07.06 make the deletion `createNumberDeletion`: this call site then
    // composes that instead.)
    deletion: inboundRouter({ db }) as ReturnType<typeof createInboundRouter>,
    skipRecipientDeliveries: (tx, recipient) => queue.skipRecipientDeliveries(tx, recipient),
    recordCompleted: (tx, counts) => recordOpsEvent(tx, { kind: "campaign.purge_completed", detail: counts }),
    log: stdoutPurgeLog,
  });
}

/** One run of the purge job (counts only in the answer). */
export function runEndOfPilotPurge(parts: { db?: Db } = {}): Promise<PurgeReport> {
  return endOfPilotPurge(parts.db ?? getDb()).run();
}
