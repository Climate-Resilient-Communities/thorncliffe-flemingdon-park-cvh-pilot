import { and, desc, eq, gt, gte, isNotNull, ne, notInArray, or, sql } from "drizzle-orm";
import {
  STUCK_QUEUE_AFTER_MS,
  UNKNOWN_IDS_LIMIT,
  UNKNOWN_WINDOW_MS,
  UNSETTLED_HAND_OFF_AFTER_MS,
  type SenderHealthReader,
} from "../application/senderHealth";
import { CEILING_EXEMPT_PURPOSES } from "../domain/deliveryRules";
import { delivery, dispatcherLease, messagingControl } from "./schema";

const behind = (ms: number) => sql`(now() - ${Math.trunc(ms)}::double precision * interval '1 millisecond')`;

/**
 * The sender's health with Drizzle, by the database's clock. "Not held by the pause" is the dispatcher's own rule (`hasDueRows`): while texts are
 * paused only the texts to on-call numbers are claimed, and a missing control row counts as paused. One statement per fact; none locks a row.
 */
export const drizzleSenderHealth: SenderHealthReader = {
  async read(executor) {
    const pausedNow = sql<boolean>`coalesce((select ${messagingControl.paused} from ${messagingControl} where ${messagingControl.id} = 1), true)`;
    const claimable = or(eq(delivery.recipientKind, "oncall"), sql`not ${pausedNow}`);
    const [facts] = await executor
      .select({
        paused: pausedNow,
        stuckQueued: sql<number>`count(*) filter (where ${delivery.state} = 'queued' and ${delivery.dueAt} <= ${behind(STUCK_QUEUE_AFTER_MS)} and (${claimable}))::int`,
        dueNow: sql<number>`count(*) filter (where ${delivery.state} = 'queued' and ${delivery.dueAt} <= now() and (${claimable}))::int`,
        unsettled: sql<number>`count(*) filter (where ${delivery.state} = 'claimed' and ${delivery.handedOffAt} < ${behind(UNSETTLED_HAND_OFF_AFTER_MS)})::int`,
      })
      .from(delivery)
      .where(or(eq(delivery.state, "queued"), and(eq(delivery.state, "claimed"), isNotNull(delivery.handedOffAt))));
    const [lease] = await executor
      .select({ agoMs: sql<number>`floor(extract(epoch from (now() - ${dispatcherLease.renewedAt})) * 1000)::bigint` })
      .from(dispatcherLease)
      .where(eq(dispatcherLease.id, 1));
    const unknown = await executor
      .select({ id: delivery.id })
      .from(delivery)
      .where(and(eq(delivery.state, "unknown"), gt(delivery.updatedAt, behind(UNKNOWN_WINDOW_MS))))
      .orderBy(desc(delivery.updatedAt), desc(delivery.id))
      .limit(UNKNOWN_IDS_LIMIT);
    const [today] = await executor
      .select({ n: sql<number>`count(*)::int` })
      .from(delivery)
      .where(
        and(
          eq(delivery.kind, "transactional"),
          ne(delivery.recipientKind, "oncall"),
          // S09.07: the replies to a campaign YES are the campaign working, not misuse (CEILING_EXEMPT_PURPOSES).
          notInArray(delivery.purpose, [...CEILING_EXEMPT_PURPOSES]),
          gte(delivery.createdAt, sql`(date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto')`),
        ),
      );
    return {
      paused: facts?.paused ?? true,
      stuckQueued: Number(facts?.stuckQueued ?? 0),
      dueNow: Number(facts?.dueNow ?? 0),
      leaseRenewedAgoMs: lease === undefined ? null : Number(lease.agoMs),
      unsettledHandOffs: Number(facts?.unsettled ?? 0),
      unknownDeliveryIds: unknown.map((row) => row.id),
      transactionalToday: Number(today?.n ?? 0),
    };
  },

  async acceptedAfter(executor, at) {
    // No index on `submitted_at`: the scan stops at the first row, and the health job asks only while a refusal is unanswered.
    const [row] = await executor.select({ id: delivery.id }).from(delivery).where(gt(delivery.submittedAt, sql`${at.toISOString()}::timestamptz`)).limit(1);
    return row !== undefined;
  },
};
