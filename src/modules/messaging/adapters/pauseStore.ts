import { and, eq, exists, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { PauseRow, PauseStore } from "../application/messagingPause";
import { delivery, messagingControl } from "./schema";

const rowOf = (row: typeof messagingControl.$inferSelect): PauseRow => ({
  paused: row.paused,
  pausedBy: row.pausedBy,
  pausedAt: row.pausedAt,
  reason: row.reason,
  handedOffAtPause: row.handedOffAtPause,
});

/**
 * A text the pause holds: not to an on-call number (`pauseApplies`), and either `queued` or `claimed` and not yet handed off. The
 * hand-off point puts a claimed one back in the queue when it finds the pause, so both are "waiting" as far as a person can tell.
 */
const held = (t: { recipientKind: AnyPgColumn; state: AnyPgColumn; handedOffAt: AnyPgColumn }) =>
  and(ne(t.recipientKind, "oncall"), or(eq(t.state, "queued"), and(eq(t.state, "claimed"), isNull(t.handedOffAt))));

/**
 * The pause switch with Drizzle. The row is the one `messaging_control` row (`id = 1`): `lock` takes it `FOR UPDATE`, so two pauses or a
 * pause and a resume wait for each other, and each change is conditional on the state it expects. The database stamps `paused_at` and
 * `updated_at` with its own `now()`, never an app server's clock.
 */
export const drizzlePauseStore: PauseStore = {
  async read(executor) {
    const [row] = await executor.select().from(messagingControl).where(eq(messagingControl.id, 1));
    return row ? rowOf(row) : null;
  },

  async lock(tx) {
    const [row] = await tx.select().from(messagingControl).where(eq(messagingControl.id, 1)).for("update");
    return row ? rowOf(row) : null;
  },

  async countWaiting(tx) {
    const [counted] = await tx.select({ n: sql<number>`count(*)::int` }).from(delivery).where(held(delivery));
    return counted?.n ?? 0;
  },

  async countHandedOffOfHeld(tx) {
    // The texts handed off of an entry (or campaign) that still has a text waiting: what the pause is part-way through stopping. A text of
    // an alert that was handed off in full, a transactional text and an on-call text are not part of any such sending.
    const waiting = alias(delivery, "waiting");
    const stillHeld = (column: "entryId" | "campaignId") =>
      exists(tx.select({ one: sql`1` }).from(waiting).where(and(eq(waiting[column], delivery[column]), held(waiting))));
    const [counted] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(delivery)
      .where(
        and(
          isNotNull(delivery.handedOffAt),
          ne(delivery.recipientKind, "oncall"),
          or(and(isNotNull(delivery.entryId), stillHeld("entryId")), and(isNotNull(delivery.campaignId), stillHeld("campaignId"))),
        ),
      );
    return counted?.n ?? 0;
  },

  async setPaused(tx, { actorStaffId, reason, handedOff }) {
    const [row] = await tx
      .update(messagingControl)
      .set({ paused: true, pausedBy: actorStaffId, pausedAt: sql`now()`, reason, handedOffAtPause: handedOff, updatedAt: sql`now()` })
      .where(and(eq(messagingControl.id, 1), eq(messagingControl.paused, false)))
      .returning();
    return row ? rowOf(row) : null;
  },

  async setResumed(tx) {
    const resumed = await tx
      .update(messagingControl)
      .set({ paused: false, pausedBy: null, pausedAt: null, reason: null, handedOffAtPause: null, updatedAt: sql`now()` })
      .where(and(eq(messagingControl.id, 1), eq(messagingControl.paused, true)))
      .returning({ id: messagingControl.id });
    return resumed.length === 1;
  },
};
