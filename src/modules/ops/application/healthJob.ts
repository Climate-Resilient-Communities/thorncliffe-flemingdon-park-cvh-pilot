// The health job (S06.07, AD-23, NFR-N6): `/api/jobs/health`, called every minute by pg_cron with the job secret. For each of five conditions it
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
//
// Each condition is judged in a transaction of its own, under a lock on its `health_condition` row, with its text, its events and its new state
// written together: two overlapping runs never text twice, and a failure leaves the condition as it was (the next minute tries again). One
// condition failing never stops the others. The texts are `transactional`, purpose `oncall_alert`, to `oncall` recipients: claim rank 1 (after
// fire alerts, before everything else), exempt from the pause, and a delivery row holds the roster entry's id and never a number (AR-12, AR-17).
// An empty roster is not an error: the event still records the condition and the Hub's banner shows a sender that is failing.
import { englishText } from "../../../i18n/text";
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import { countSms, LEASE_STALE_AFTER_MS, type DeliveryResult, type Enqueued, type SenderHealthReader, type TransactionalInput } from "../../messaging";
import { healthStore } from "../adapters/healthStore";
import { oncallStore } from "../adapters/oncallStore";
import { SENDER_CONDITIONS, SIGNATURE_FAILURE_LIMIT, SIGNATURE_WINDOW_MS, decide, type Observation } from "../domain/health";
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
}

export interface HealthJob {
  run(): Promise<HealthReport>;
}

const nameOf = (error: unknown) => (error instanceof Error ? error.name : "NonError");

/** The text to the on-call Admins for a condition: English, counts only, one segment where the count allows. */
export function oncallText(condition: HealthCondition, count: number): string {
  return englishText(`ops.oncall.text.${condition}`, { count });
}

export function createHealthJob(deps: HealthJobDeps): HealthJob {
  const { db, sender } = deps;
  const record = deps.record ?? ((executor, event) => recordOpsEvent(executor, event));

  /** What the job sees now for one condition, in the condition's transaction. */
  async function observe(tx: DbTransaction, condition: HealthCondition, lastEventId: number | null, active: boolean): Promise<Observation & { eventId: number | null }> {
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
    }
  }

  /** Queues one text per on-call number; returns how many. A refusal from the outbox is a bug in this file, so it throws and the condition is left as it was. */
  async function textTheOncall(tx: DbTransaction, condition: HealthCondition, count: number, now: Date): Promise<number> {
    const ids = await oncallStore.ids(tx);
    if (ids.length === 0) return 0;
    const body = oncallText(condition, count);
    const segments = countSms(body).segments;
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
      const seen = await observe(tx, condition, state.lastEventId, state.active);
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
      return { conditions };
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
