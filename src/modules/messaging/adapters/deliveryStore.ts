import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { DbTransaction } from "../../../platform/db";
import type { DeliveryKind, CreatingModule, RecipientKind } from "../domain/deliveryRules";
import type { DeliveryState } from "../domain/deliveryState";
import type { DeliveryStore, DeliveryView, Enqueued, NewDelivery, SendBy } from "../application/deliveryPorts";
import { delivery } from "./schema";

/** Rows per INSERT: 500 rows of 15 parameters stay far from the driver's limit of 65,535 parameters. */
const INSERT_CHUNK = 500;

type DeliveryRow = typeof delivery.$inferSelect;

export const viewOf = (row: DeliveryRow): DeliveryView => ({
  id: row.id,
  kind: row.kind as DeliveryKind,
  recipientKind: row.recipientKind as RecipientKind,
  recipientId: row.recipientId,
  entryId: row.entryId,
  campaignId: row.campaignId,
  createdByModule: row.createdByModule as CreatingModule,
  purpose: row.purpose,
  lang: row.lang,
  body: row.body,
  segments: row.segments,
  costEstimateCents: row.costEstimateCents,
  idempotencyKey: row.idempotencyKey,
  callbackRef: row.callbackRef,
  state: row.state as DeliveryState,
  attempts: row.attempts,
  dueAt: row.dueAt,
  sendBy: row.sendBy,
  claimedAt: row.claimedAt,
  claimedBy: row.claimedBy,
  claimToken: row.claimToken,
  handedOffAt: row.handedOffAt,
  submittedAt: row.submittedAt,
  providerMessageId: row.providerMessageId,
  providerErrorCode: row.providerErrorCode,
  completedAt: row.completedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  resendOf: row.resendOf,
  resendN: row.resendN,
});

/** `send_by` as the insert takes it: an instant, or the database's now() plus a whole number of milliseconds (no app clock). */
const sendByValue = (sendBy: SendBy | null) => {
  if (sendBy === null) return null;
  if ("at" in sendBy) return sendBy.at;
  return sql`now() + (${Math.trunc(sendBy.withinMs)}::bigint * interval '1 millisecond')`;
};

/**
 * The outbox with Drizzle, in the caller's transaction (every statement goes through `tx`).
 *
 * Idempotency: the insert is `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`. When another transaction is inserting
 * the same key, this statement waits for it: if it commits, nothing is inserted here and the row is read back (READ
 * COMMITTED sees it); if it rolls back, this insert goes ahead. So exactly one row exists, and neither caller gets an error.
 * The insert triggers run before the conflict is known, so a duplicate from outside an approval is still refused for an
 * alert (a retry of a use case runs inside its transaction again).
 */
export const drizzleDeliveryStore: DeliveryStore = {
  async insert(tx, rows) {
    const created = new Map<string, DeliveryRow>();
    for (let from = 0; from < rows.length; from += INSERT_CHUNK) {
      const chunk = rows.slice(from, from + INSERT_CHUNK);
      const inserted = await tx
        .insert(delivery)
        .values(
          chunk.map((row: NewDelivery) => ({
            id: row.id,
            kind: row.kind,
            recipientKind: row.recipientKind,
            recipientId: row.recipientId,
            entryId: row.entryId,
            campaignId: row.campaignId,
            createdByModule: row.createdByModule,
            purpose: row.purpose,
            lang: row.lang,
            body: row.body,
            segments: row.segments,
            costEstimateCents: row.costEstimateCents,
            idempotencyKey: row.idempotencyKey,
            sendBy: sendByValue(row.sendBy),
          })),
        )
        .onConflictDoNothing({ target: delivery.idempotencyKey })
        .returning();
      for (const row of inserted) created.set(row.idempotencyKey, row);
    }
    const missing = [...new Set(rows.map((row) => row.idempotencyKey))].filter((key) => !created.has(key));
    const existing = new Map<string, DeliveryRow>();
    for (let from = 0; from < missing.length; from += INSERT_CHUNK) {
      const found = await tx.select().from(delivery).where(inArray(delivery.idempotencyKey, missing.slice(from, from + INSERT_CHUNK)));
      for (const row of found) existing.set(row.idempotencyKey, row);
    }
    const reported = new Set<string>();
    return rows.map((row): Enqueued => {
      const first = !reported.has(row.idempotencyKey);
      reported.add(row.idempotencyKey);
      const made = created.get(row.idempotencyKey);
      if (made) return { delivery: viewOf(made), created: first };
      const found = existing.get(row.idempotencyKey);
      if (!found) throw new Error("delivery: a key that conflicted was not found afterwards");
      return { delivery: viewOf(found), created: false };
    });
  },

  async markApproval(tx: DbTransaction, entryId) {
    await tx.execute(sql`select set_config('cvh.approval_entry_id', ${entryId}, true)`);
  },

  async skipForRecipient(tx: DbTransaction, recipient) {
    const mine = and(eq(delivery.recipientKind, recipient.kind), eq(delivery.recipientId, recipient.id));
    // One statement: it waits for a row another transaction holds and then re-checks that the row is still unhanded, so a
    // hand-off that commits first leaves its row alone (it is then counted as in flight).
    const skipped = await tx
      .update(delivery)
      .set({ state: "skipped" })
      .where(and(mine, isNull(delivery.handedOffAt), inArray(delivery.state, ["queued", "claimed"])))
      .returning({ id: delivery.id });
    // In flight: submitted or unknown (both follow a hand-off), or claimed and handed off.
    const inFlight = await tx
      .select({ id: delivery.id })
      .from(delivery)
      .where(and(mine, or(inArray(delivery.state, ["submitted", "unknown"]), and(eq(delivery.state, "claimed"), isNotNull(delivery.handedOffAt)))));
    return { skipped: skipped.length, inFlight: inFlight.length };
  },

  async cancelForEntries(tx: DbTransaction, entryIds) {
    const mine = and(inArray(delivery.entryId, [...entryIds]), eq(delivery.kind, "alert"));
    // One statement, like `skipForRecipient`: it waits for a row another transaction holds (the dispatcher's claim or hand-off) and then re-checks that
    // the row is still unhanded, so a hand-off that commits first leaves its row alone.
    const cancelled = await tx
      .update(delivery)
      .set({ state: "cancelled" })
      .where(and(mine, isNull(delivery.handedOffAt), inArray(delivery.state, ["queued", "claimed"])))
      .returning({ id: delivery.id });
    const inFlight = await tx
      .select({ id: delivery.id })
      .from(delivery)
      .where(and(mine, or(inArray(delivery.state, ["submitted", "unknown"]), and(eq(delivery.state, "claimed"), isNotNull(delivery.handedOffAt)))));
    return { cancelled: cancelled.length, inFlight: inFlight.length };
  },
};
