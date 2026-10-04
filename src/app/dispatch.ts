// Composition root of the sender (S06.02, AD-2, AD-8): the validated environment, the app's database, the ContactResolver
// (src/app/messaging.ts), alerting's reader of entries and threads, ops' event log and, in production only, Twilio's Messaging
// Service. Server only. This is the one place that reads Twilio's credentials for sending, and only where SMS_MODE is `live`: under
// `log` the dispatcher gets no provider and nothing here touches `env.twilio`.
//
// Two ways in, one use case: `/api/jobs/dispatch` (pg_cron every minute, with the job secret, `maxDuration` 60 s, a run of up to 60 s) and
// `kickDispatcher()`, which the approval use case (S04.07) calls right after its transaction ends, in `after()` of the approving
// request, with a shorter run (KICK_RUN_LIMIT_MS) because it lives only as long as that request's function. Both take the sender
// lease or exit without claiming, so they can overlap safely.
import "server-only";
import { after } from "next/server";
import { alertStandingReader } from "@/modules/alerting";
import {
  createDeliveryQueue,
  createDispatcher,
  KICK_RUN_LIMIT_MS,
  createServiceCheck,
  stdoutMessagingLog,
  twilioMessageSubmitter,
  twilioMessagingServiceReader,
  type AlertStandingReader,
  type ContactResolver,
  type DispatchReport,
  type Dispatcher,
  type DispatcherClock,
  type DispatcherDeps,
  type DispatcherConfig,
  type MessagingLog,
  type OpsRecorder,
  type ServiceCheckFinding,
} from "@/modules/messaging";
import { recordOpsEvent, recordOpsEventUnlessBusy } from "@/modules/ops";
import { forgetOptedOutSignup } from "@/modules/subscriptions";
import { getEnv, type Env } from "@/platform/config/env";
import { getDb, type Db } from "@/platform/db";
import { contactResolver } from "./messaging";
import { appSmsSpend } from "./smsSpend";

/**
 * How many `webhook.signature_invalid` events are kept in any 10 minutes. Anyone can send a request with a wrong signature, so the
 * events are capped (S06.04): the health job alerts above 5 in 10 minutes (S06.07), and a count that has reached this many is far past it,
 * so a flood cannot make `ops_event` grow without limit and nothing the alert needs is lost.
 *
 * Known limit: the cap bounds the table's growth, not the work a flood causes. Every unsigned request still costs one indexed `count(*)`
 * on the shared pool (and an insert while under the cap), the same database the dispatcher uses; the pool's size is what bounds it, as
 * for the other public routes that touch the database per request. If it ever matters, a per-instance flag set when the count first
 * reaches `max` (skip the database until a short window passes) removes the round trips; it was left out because it makes the cap depend on
 * instance memory and on a clock the tests would have to control.
 */
export const SIGNATURE_FAILURE_EVENT_LIMIT = { max: 50, withinMs: 10 * 60_000 } as const;

/** Messaging's operational events, written to `ops_event` (messaging may not import ops; the graph has ops depend on messaging). */
export const opsRecorder: OpsRecorder = {
  async record(executor, event) {
    switch (event.kind) {
      case "delivery.unknown":
        return recordOpsEvent(executor, { kind: event.kind, subjectType: "delivery", subjectId: event.deliveryId, detail: event.detail });
      case "dispatch.provider_auth_failed":
        return recordOpsEvent(executor, { kind: event.kind, detail: event.detail });
      case "messaging.smart_encoding_on":
      case "messaging.smart_encoding_off":
        return recordOpsEvent(executor, { kind: event.kind, detail: event.detail });
      case "messaging.service_check_failed":
      case "messaging.service_settings_wrong":
      case "messaging.service_settings_ok":
        return recordOpsEvent(executor, { kind: event.kind, detail: event.detail });
      case "delivery.unknown_resolved":
      case "delivery.provider_id_mismatch":
        return recordOpsEvent(executor, { kind: event.kind, subjectType: "delivery", subjectId: event.deliveryId, detail: event.detail });
      case "delivery.callback_ignored":
        return recordOpsEvent(executor, {
          kind: event.kind,
          ...(event.deliveryId === undefined ? {} : { subjectType: "delivery", subjectId: event.deliveryId }),
          detail: event.detail,
        });
      case "webhook.signature_invalid":
        // Capped: anyone can send a request with a wrong signature (see SIGNATURE_FAILURE_EVENT_LIMIT).
        await recordOpsEventUnlessBusy(executor, { kind: event.kind, detail: event.detail }, SIGNATURE_FAILURE_EVENT_LIMIT);
        return;
    }
  },
};

/** The real clock. The database's clock decides everything that matters (the lease, a claim's age, a backoff), so there is no skew. */
export const systemClock: DispatcherClock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  skewMs: () => 0,
};

/** Live sending is asked for but Twilio's account or Messaging Service is not set (names the rule, never a value). */
export class SenderNotConfigured extends Error {
  constructor(readonly rule: string) {
    super(rule);
    this.name = "SenderNotConfigured";
  }
}

type SenderEnv = Pick<Env, "smsMode" | "twilio" | "publicBaseUrl">;

/**
 * Where the dispatcher sends. Under `SMS_MODE=log` it sends nowhere and `env.twilio` is not read at all; under `live` (production
 * only, which the env schema enforces) it needs Twilio's account and the Messaging Service, or it refuses to run, so no row is claimed
 * that could not be sent.
 */
export function dispatcherConfig(env: SenderEnv): DispatcherConfig {
  if (env.smsMode === "log") return { mode: "log" };
  const twilio = env.twilio;
  if (!twilio) throw new SenderNotConfigured("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are not set");
  if (!twilio.messagingServiceSid) throw new SenderNotConfigured("TWILIO_MESSAGING_SERVICE_SID is not set");
  return {
    mode: "live",
    submitter: twilioMessageSubmitter({ accountSid: twilio.accountSid, authToken: twilio.authToken }),
    messagingServiceSid: twilio.messagingServiceSid,
    publicBaseUrl: env.publicBaseUrl,
  };
}

export interface DispatcherParts {
  env?: SenderEnv & Pick<Env, "smsSegmentsPerSecond" | "smsPricePerSegmentCents">;
  db?: Db;
  resolver?: ContactResolver;
  alerts?: AlertStandingReader;
  clock?: DispatcherClock;
  log?: MessagingLog;
  ops?: OpsRecorder;
  /** The run's time limit (default 60 s, the job route's `maxDuration`); the kick passes KICK_RUN_LIMIT_MS. */
  runLimitMs?: number;
  /** S06.08's spend seams (see DispatcherDeps): by default the app's own hooks, which write a text's estimate with its outcome (the status callbacks are given the same ones). */
  afterOutcome?: DispatcherDeps["afterOutcome"];
  afterProviderId?: DispatcherDeps["afterProviderId"];
  /** S07.02's seam (see DispatcherDeps): by default `failureHooks`, the same the status callbacks are given. */
  afterFailure?: DispatcherDeps["afterFailure"];
}

/**
 * What a text refused for good means to the module that owns its recipient (the sender's and the status callbacks' `afterFailure`):
 * subscriptions forgets a pending sign-up whose confirmation was refused because the number texted STOP (S07.02).
 */
export const failureHooks: NonNullable<DispatcherDeps["afterFailure"]> = forgetOptedOutSignup({
  skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
});

/** The dispatcher on the real environment and database (every part can be replaced in a test). Throws SenderNotConfigured where live sending is not set up. */
export function appDispatcher(parts: DispatcherParts = {}): Dispatcher {
  const env = parts.env ?? getEnv();
  // The estimate of each text is written with its outcome (S06.08), by the hooks the status callbacks are given too.
  const spend = appSmsSpend(env);
  return createDispatcher({
    db: parts.db ?? getDb(),
    resolver: parts.resolver ?? contactResolver(),
    alerts: parts.alerts ?? alertStandingReader,
    ops: parts.ops ?? opsRecorder,
    log: parts.log ?? stdoutMessagingLog,
    clock: parts.clock ?? systemClock,
    config: dispatcherConfig(env),
    segmentsPerSecond: env.smsSegmentsPerSecond,
    runLimitMs: parts.runLimitMs,
    afterOutcome: parts.afterOutcome ?? spend.afterOutcome,
    afterProviderId: parts.afterProviderId ?? spend.afterProviderId,
    afterFailure: parts.afterFailure ?? failureHooks,
  });
}

/** One dispatcher run: takes the sender lease or exits without claiming. */
export function runDispatchJob(parts: DispatcherParts = {}): Promise<DispatchReport> {
  return appDispatcher(parts).run();
}

/**
 * The run an approval starts: a short one (KICK_RUN_LIMIT_MS, 20 s, so it sends for 10 s, about 30 segments). It lives inside the
 * approving request's function, after the response, and a function that ends mid-run could be killed after a hand-off was saved and
 * before the provider call or the outcome write, which leaves that text `unknown` (never sent again). pg_cron's next run, with the
 * full minute, sends whatever the kick did not.
 */
export function runKickJob(parts: DispatcherParts = {}): Promise<DispatchReport> {
  return runDispatchJob({ ...parts, runLimitMs: KICK_RUN_LIMIT_MS });
}

/**
 * Starts the dispatcher right after an approval's transaction ends (AD-8). Call it once the approving transaction has finished, never
 * inside it: the run only sees rows that are saved. It never throws and never waits for the run; the run finishes after the response
 * (`after`), and an error is logged. Where no request is under way (a script or a test) the run just starts.
 *
 * The run uses the approving request's function time: the route or action that calls this must export `maxDuration = 60` (S06.02's
 * note for S04.07 in epics.md), and the run's own limit is KICK_RUN_LIMIT_MS, so the approval's work and the run fit inside it.
 */
export function kickDispatcher(run: () => Promise<DispatchReport> = runKickJob, schedule: (task: () => Promise<void>) => void = scheduleAfterResponse): void {
  schedule(async () => {
    try {
      await run();
    } catch (error) {
      stdoutMessagingLog.error("dispatch.kick_failed", { error: error instanceof Error ? error.name : "NonError" });
    }
  });
}

function scheduleAfterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    // Outside a request there is no `after`: the work still must not be lost, so it starts now.
    void task();
  }
}

/** The daily check of the Messaging Service's Smart Encoding setting; under `log` there is no Twilio account to ask and nothing is read. */
export async function runMessagingServiceCheck(
  parts: { env?: Pick<Env, "smsMode" | "twilio">; db?: Db; log?: MessagingLog; ops?: OpsRecorder } = {},
): Promise<ServiceCheckFinding | { status: "not_live" }> {
  const env = parts.env ?? getEnv();
  if (env.smsMode !== "live") return { status: "not_live" };
  const twilio = env.twilio;
  if (!twilio) throw new SenderNotConfigured("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are not set");
  if (!twilio.messagingServiceSid) throw new SenderNotConfigured("TWILIO_MESSAGING_SERVICE_SID is not set");
  return createServiceCheck({
    db: parts.db ?? getDb(),
    reader: twilioMessagingServiceReader({ accountSid: twilio.accountSid, authToken: twilio.authToken }),
    messagingServiceSid: twilio.messagingServiceSid,
    ops: parts.ops ?? opsRecorder,
    log: parts.log ?? stdoutMessagingLog,
  }).run();
}
