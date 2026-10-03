// Composition root of the reconciliation of Twilio's prices (S06.08, AD-2, AD-8): the app's database, the spend module's reconciler, the
// delivery provider ids messaging gives it (spend may not import messaging) and, in production only, Twilio's Messages API listed through
// messaging's adapter. Server only. This is the one place that reads Twilio's credentials for the reconciliation, and only where
// SMS_MODE is `live`: everywhere else there is no Twilio account (no credentials exist outside production), the job answers `not_live` and
// nothing here touches `env.twilio` or the network. The real adapter is built here and called only by the job's route in production; every
// test gives the job a fake lister.
//
// The reconciliation is triggered by a job endpoint, `POST /api/jobs/reconcile-spend` (the job secret, like the dispatcher's), because the
// credentials exist only where the app runs in production: a script run elsewhere would have none. pg_cron calls it daily and each run is
// idempotent (a complete month is not listed again, a pending month is tried again), and the monthly reconciliation of the manual
// operations list is that call, or the same call by hand after the month ends.
import "server-only";
import { deliveryProviderIds, twilioMessageLister } from "@/modules/messaging";
import { createSmsReconciler, stdoutSpendLog, type MonthKey, type ReconcileResult, type SmsMessageLister, type SmsReconcilerDeps, type SpendLog } from "@/modules/spend";
import { getEnv, type Env } from "@/platform/config/env";
import { getDb, type Db } from "@/platform/db";
import { SenderNotConfigured } from "./dispatch";

export interface ReconcileParts {
  env?: Pick<Env, "smsMode" | "twilio" | "smsUsdToCadRate">;
  db?: Db;
  /** Test seam: a fake Twilio listing. With none, the real one is built, and only where SMS_MODE is `live`. */
  lister?: SmsMessageLister;
  now?: () => Date;
  log?: SpendLog;
  limits?: SmsReconcilerDeps["limits"];
}

export type ReconcileJobResult = { status: "not_live" } | { status: "ok"; results: { id: string; result: ReconcileResult }[] };

/**
 * The reconciler on the real environment and database. Where there is no lister (a test gives one; production builds Twilio's) it throws
 * SenderNotConfigured for a live environment without Twilio's account, and returns null where nothing is live.
 */
export function appSmsReconciler(parts: ReconcileParts = {}) {
  const env = parts.env ?? getEnv();
  let lister = parts.lister;
  if (!lister) {
    if (env.smsMode !== "live") return null;
    const twilio = env.twilio;
    if (!twilio) throw new SenderNotConfigured("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are not set");
    lister = twilioMessageLister({ accountSid: twilio.accountSid, authToken: twilio.authToken });
  }
  return createSmsReconciler({
    db: parts.db ?? getDb(),
    lister,
    providerIds: deliveryProviderIds,
    usdToCadRate: env.smsUsdToCadRate,
    now: parts.now ?? (() => new Date()),
    log: parts.log ?? stdoutSpendLog,
    limits: parts.limits,
  });
}

/**
 * One run of the job: the months asked for, or what is due (the month before this one, and every month still pending). Outside production
 * it lists nothing and answers `not_live`.
 */
export async function runReconcileJob(input: { months?: readonly MonthKey[] } = {}, parts: ReconcileParts = {}): Promise<ReconcileJobResult> {
  const reconciler = appSmsReconciler(parts);
  if (!reconciler) return { status: "not_live" };
  return { status: "ok", results: await reconciler.reconcileDue(input.months) };
}
