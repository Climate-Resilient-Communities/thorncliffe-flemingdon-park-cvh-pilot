// The health job (S06.07, S09.01, AD-23, NFR-N6): `/api/jobs/health`, called every minute by pg_cron with the job secret. For each condition it
// judges whether it holds, writes an `ops_event` (no personal data) when it texts the on-call Admins or when it clears, and queues one
// `transactional` text per on-call number, at most once per condition per 30 minutes (domain/health.ts).
//
//  - queue_stuck: a text queued and due for more than 5 minutes outside a pause (during a pause, only the texts the pause does not hold: to on-call
//    numbers). A level condition.
//  - delivery_unknown: a delivery is `unknown` (the sender recorded `delivery.unknown`), or a text is still handed off with no outcome after
//    10 minutes (the sweep makes it `unknown` after 5, so an older one is a text it could not settle). An event condition: each new one is texted
//    about once, and the condition clears when every unknown delivery has been answered.
//  - sender_stalled: the sender lease has not been renewed for 3 minutes while texts are due. A level condition.
//  - smart_encoding_on: the daily check found Smart Encoding on in the Messaging Service; it clears when a later check finds it off. An event condition.
//  - signature_failures: more than 5 webhook signature failures in 10 minutes. A level condition.
//  From S09.01 (E09 "Health conditions"):
//  - job_failed: a pg_cron run failed, or a job's call (pg_net) did not answer 2xx, in the last 10 minutes. A level condition: it clears after
//    10 minutes with no failure.
//  - translation_fallback: an alert was submitted with a whole language in English (`alert.translation_fallback`) in the last 24 hours. An event
//    condition: each new one is texted about once; it clears 24 hours after the last.
//  - publish_failed: a directory publish failed (`directory.publish_failed`) after the last one that succeeded. An event condition: it clears
//    when a publish succeeds (directory's `lastPublishedAt`).
//  - transactional_ceiling: more non-alert texts were created since midnight in Toronto than the daily ceiling (SMS_TRANSACTIONAL_DAILY_CEILING,
//    on-call texts not counted). Texted about once that day (S07.09: "on-call is alerted once that day"; texts keep sending); it clears at midnight.
//  - cap_overrun: a spending cap overrun (`spend.cap_overrun`, S07.08) was recorded this month in Toronto. An event condition: each new one is
//    texted about once; it clears when the month ends.
//  "Messaging Service settings wrong" is smart_encoding_on (S06.02's daily check; S07.09 adds its other settings to that check).
//
// Each run that judged every condition records the heartbeat (`health_heartbeat`), which `/api/health/heartbeat` reads for the outside check: a
// run in which a condition could not be judged does not, so a job that keeps failing is seen from outside like a job that does not run.
//
// Each condition is judged in a transaction of its own, under a lock on its `health_condition` row, with its text, its events and its new state
// written together: two overlapping runs never text twice, and a failure leaves the condition as it was (the next minute tries again). One
// condition failing never stops the others. The texts are `transactional`, purpose `oncall_alert`, to `oncall` recipients: claim rank 1 (after
// fire alerts, before everything else), exempt from the pause, and a delivery row holds the roster entry's id and never a number (AR-12, AR-17).
// An empty roster is not an error: the event still records the condition and the Hub's banner shows a sender that is failing.
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import { LEASE_STALE_AFTER_MS, type DeliveryResult, type Enqueued, renderOncallText, type SenderHealthReader, type TransactionalInput } from "../../messaging";
import { healthStore } from "../adapters/healthStore";
import { oncallStore } from "../adapters/oncallStore";
import {
  FALLBACK_WINDOW_MS,
  JOB_FAILURE_WINDOW_MS,
  SENDER_CONDITIONS,
  SIGNATURE_FAILURE_LIMIT,
  SIGNATURE_WINDOW_MS,
  decide,
  heartbeatFresh,
  type Observation,
} from "../domain/health";
import { HEALTH_CONDITIONS, type HealthCondition, type OpsEvent } from "../domain/events";
import { recordOpsEvent } from "./recordOpsEvent";

export interface HealthJobDeps {
  db: Db;
  /** messaging's `createSenderHealth()`: counts and ages from the outbox's tables. */
  sender: SenderHealthReader;
  /** messaging's `createDeliveryQueue().enqueueTransactional`. */
  enqueue: (tx: DbTransaction, input: TransactionalInput) => Promise<DeliveryResult<Enqueued>>;
  /** Cents CAD per text message segment (SMS_PRICE_PER_SEGMENT_CENTS), for each text's cost estimate. */
  pricePerSegmentCents: () => number;
  /** The daily ceiling on non-alert texts (SMS_TRANSACTIONAL_DAILY_CEILING, S09.01): more than this since midnight in Toronto raises the condition. */
  transactionalDailyCeiling: () => number;
  /** directory's instant of the last directory publish that succeeded (null: none yet). ops may not read `directory_release` (AD-2). */
  lastPublishedAt: (executor: DbExecutor) => Promise<Date | null>;
  /** Test seam: the event writer (default `recordOpsEvent`). */
  record?: (executor: DbExecutor, event: OpsEvent) => Promise<void>;
  /** Operational error log (structured, no personal data): a condition's code and the error's name only. */
  logError: (evt: string, fields: Record<string, string>) => void;
}

/** What one run did, per condition: codes and counts only. */
export interface ConditionReport {
  condition: HealthCondition;
  /** `ok`: judged; `failed`: the judgement threw and the condition is as it was. */
  status: "ok" | "failed";
  holds?: boolean;
  /** `alerted`: the on-call Admins were texted (or the event recorded, with an empty roster); `recovered`; `held`: holds, nothing texted now. */
  action?: "quiet" | "held" | "alerted" | "recovered";
  texts?: number;
}

export interface HealthReport {
  conditions: ConditionReport[];
  /** Whether this run recorded the heartbeat: every condition was judged and the time was written. */
  heartbeat: boolean;
}

export interface HealthJob {
  run(): Promise<HealthReport>;
}

const nameOf = (error: unknown) => (error instanceof Error ? error.name : "NonError");

/** The text to the on-call Admins for a condition: built by messaging's renderer (AD-21), English, counts only, one segment. */
export function oncallText(condition: HealthCondition, count: number): string {
  return renderOncallText(condition, count).body;
}

export function createHealthJob(deps: HealthJobDeps): HealthJob {
  const { db, sender } = deps;
  const record = deps.record ?? ((executor, event) => recordOpsEvent(executor, event));

  /** An event condition over the `ops_event` rows of a kind after a point: holds while there is one, new when one is past the last told. */
  async function eventsObserved(tx: DbTransaction, kind: string, after: Parameters<typeof healthStore.eventsAfter>[2], lastEventId: number | null): Promise<Observation & { eventId: number | null }> {
    const { count, newestId } = await healthStore.eventsAfter(tx, kind, after);
    return { holds: count > 0, count, fresh: newestId !== null && newestId > (lastEventId ?? 0), eventId: newestId };
  }

  /** What the job sees now for one condition, in the condition's transaction. */
  async function observe(
    tx: DbTransaction,
    condition: HealthCondition,
    state: { lastEventId: number | null; active: boolean; lastAlertedAt: Date | null },
  ): Promise<Observation & { eventId: number | null }> {
    const { lastEventId, active } = state;
    switch (condition) {
      case "queue_stuck": {
        const facts = await sender.read(tx);
        return { holds: facts.stuckQueued > 0, count: facts.stuckQueued, eventId: null };
      }
      case "sender_stalled": {
        const facts = await sender.read(tx);
        const stale = facts.leaseRenewedAgoMs === null || facts.leaseRenewedAgoMs > LEASE_STALE_AFTER_MS;
        return { holds: facts.dueNow > 0 && stale, count: facts.dueNow, eventId: null };
      }
      case "delivery_unknown": {
        const facts = await sender.read(tx);
        const eventId = await healthStore.latestUnknownEvent(tx, facts.unknownDeliveryIds);
        const count = facts.unknownDeliveryIds.length + facts.unsettledHandOffs;
        // New: an unknown delivery whose event the last text did not cover, or a stuck hand-off at the start of the condition (it has no event yet).
        const fresh = (eventId !== null && eventId > (lastEventId ?? 0)) || (facts.unsettledHandOffs > 0 && !active);
        return { holds: count > 0, count, fresh, eventId };
      }
      case "smart_encoding_on": {
        const latest = await healthStore.latestOfKinds(tx, ["messaging.smart_encoding_on", "messaging.smart_encoding_off"]);
        if (latest === null || latest.kind !== "messaging.smart_encoding_on") return { holds: false, count: 0, eventId: null };
        return { holds: true, count: 1, fresh: latest.id > (lastEventId ?? 0), eventId: latest.id };
      }
      case "signature_failures": {
        const failures = await healthStore.countRecent(tx, "webhook.signature_invalid", SIGNATURE_WINDOW_MS);
        return { holds: failures > SIGNATURE_FAILURE_LIMIT, count: failures, eventId: null };
      }
      case "job_failed": {
        const failures = await healthStore.jobFailures(tx, JOB_FAILURE_WINDOW_MS);
        return { holds: failures > 0, count: failures, eventId: null };
      }
      case "translation_fallback":
        return eventsObserved(tx, "alert.translation_fallback", { withinMs: FALLBACK_WINDOW_MS }, lastEventId);
      case "publish_failed":
        return eventsObserved(tx, "directory.publish_failed", { at: await deps.lastPublishedAt(tx) }, lastEventId);
      case "cap_overrun":
        return eventsObserved(tx, "spend.cap_overrun", { torontoMonth: true }, lastEventId);
      case "transactional_ceiling": {
        const facts = await sender.read(tx);
        const dayStart = await healthStore.torontoDayStart(tx);
        // Once that day: new only while nobody has been texted about it since midnight in Toronto.
        const fresh = state.lastAlertedAt === null || state.lastAlertedAt < dayStart;
        return { holds: facts.transactionalToday > deps.transactionalDailyCeiling(), count: facts.transactionalToday, fresh, eventId: null };
      }
    }
  }

  /** Queues one text per on-call number; returns how many. A refusal from the outbox is a bug in this file, so it throws and the condition is left as it was. */
  async function textTheOncall(tx: DbTransaction, condition: HealthCondition, count: number, now: Date): Promise<number> {
    const ids = await oncallStore.ids(tx);
    if (ids.length === 0) return 0;
    const { body, segments } = renderOncallText(condition, count);
    const costEstimateCents = Math.ceil(segments * deps.pricePerSegmentCents());
    const stamp = now.getTime();
    for (const id of ids) {
      const queued = await deps.enqueue(tx, {
        module: "ops",
        purpose: "oncall_alert",
        recipient: { kind: "oncall", id },
        // The key is transactional:{condition}:oncall_alert:{roster entry}.{millisecond of this alert}: one text per number per alert, and no number in it.
        subject: condition,
        nonce: `${id}.${stamp}`,
        lang: "en",
        body,
        segments,
        costEstimateCents,
      });
      if (!queued.ok) throw new Error(`ops: the outbox refused an on-call text (${queued.error})`);
    }
    return ids.length;
  }

  async function judge(condition: HealthCondition): Promise<ConditionReport> {
    return db.transaction(async (tx): Promise<ConditionReport> => {
      const locked = await healthStore.lock(tx, condition);
      if (!locked) throw new Error("ops: health_condition has no row for the condition");
      const { state, now } = locked;
      const seen = await observe(tx, condition, state);
      const decision = decide(state, seen, now);
      switch (decision.kind) {
        case "quiet":
          await healthStore.save(tx, condition, { active: false, keepSince: false, alerted: false, eventId: null });
          return { condition, status: "ok", holds: false, action: "quiet" };
        case "recover":
          await healthStore.save(tx, condition, { active: false, keepSince: false, alerted: false, eventId: null });
          await record(tx, { kind: "health.condition_recovered", detail: { condition } });
          return { condition, status: "ok", holds: false, action: "recovered" };
        case "hold":
          // A new episode inside the 30-minute text interval is texted about by no one, but it is still recorded: the limit is on texts, not on the record.
          if (decision.begins) await record(tx, { kind: "health.condition_alerted", detail: { condition, count: seen.count, notified: 0, first: true, rate_limited: true } });
          await healthStore.save(tx, condition, { active: true, keepSince: !decision.begins, alerted: false, eventId: null });
          return { condition, status: "ok", holds: true, action: "held" };
        case "alert": {
          const texts = await textTheOncall(tx, condition, seen.count, now);
          await record(tx, { kind: "health.condition_alerted", detail: { condition, count: seen.count, notified: texts, first: decision.begins } });
          await healthStore.save(tx, condition, { active: true, keepSince: !decision.begins, alerted: true, eventId: seen.eventId });
          return { condition, status: "ok", holds: true, action: "alerted", texts };
        }
      }
    });
  }

  return {
    async run() {
      const conditions: ConditionReport[] = [];
      for (const condition of HEALTH_CONDITIONS) {
        try {
          conditions.push(await judge(condition));
        } catch (error) {
          deps.logError("health.condition_failed", { condition, error: nameOf(error) });
          conditions.push({ condition, status: "failed" });
        }
      }
      // The heartbeat (S09.01) only when every condition was judged: a run that could not judge one is, seen from outside, a job that is failing.
      let heartbeat = false;
      if (conditions.every((row) => row.status === "ok")) {
        try {
          await healthStore.beat(db);
          heartbeat = true;
        } catch (error) {
          deps.logError("health.heartbeat_failed", { error: nameOf(error) });
        }
      }
      return { conditions, heartbeat };
    },
  };
}

/**
 * The conditions that mean the sender is not sending, as the Hub's banner shows them (S06.07): from what the last run remembered, not from a
 * fresh judgement, so the banner is one cheap read on every Hub screen. Empty when sending is healthy or the job has not noticed.
 */
export async function activeSenderConditions(executor: DbExecutor): Promise<{ condition: (typeof SENDER_CONDITIONS)[number]; since: Date }[]> {
  const active = await healthStore.active(executor);
  return active.flatMap((row) => {
    const condition = (SENDER_CONDITIONS as readonly string[]).includes(row.condition) ? (row.condition as (typeof SENDER_CONDITIONS)[number]) : null;
    return condition === null ? [] : [{ condition, since: row.since }];
  });
}

/** A condition the health job last found holding, and since when (S09.01: every Admin and Coordinator screen names each). */
export interface ActiveCondition {
  condition: HealthCondition;
  since: Date;
}

/** Every condition the health job last found holding, in the order of HEALTH_CONDITIONS (one cheap read, like the sender banner's). */
export async function activeHealthConditions(executor: DbExecutor): Promise<ActiveCondition[]> {
  const active = await healthStore.active(executor);
  return HEALTH_CONDITIONS.flatMap((condition) => {
    const row = active.find((candidate) => candidate.condition === condition);
    return row === undefined ? [] : [{ condition, since: row.since }];
  });
}

/**
 * The heartbeat (S09.01): when the health job last judged every condition (null: it never has) and whether that is less than 3 minutes ago by
 * the database's clock. `/api/health/heartbeat` answers by `fresh`; the Hub's banner says the check has stopped when it ran once and is not fresh.
 */
export async function readHeartbeat(executor: DbExecutor): Promise<{ completedAt: Date | null; fresh: boolean }> {
  const { completedAt, now } = await healthStore.heartbeat(executor);
  return { completedAt, fresh: heartbeatFresh(completedAt, now) };
}
