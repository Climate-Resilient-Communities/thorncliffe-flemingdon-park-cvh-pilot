// The statements of subscribers and their prompts (S07.04). Every one runs in the caller's transaction. The number is selected only by
// `phoneOf` (the ContactResolver's source, at the hand-off point); the router and the web sign-up find a subscriber by number and read back
// its id, language and prompt, never the number.
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { smsPrompt, subscriber, subscriberPlace, subscriberTopicOptout } from "./schema";

/** The retention states that receive texts (E07 "Matching subscribers"; E09 adds the re-consent deadline to `reconsent_pending`). */
export const RECEIVING_STATES = ["active", "reconsent_pending", "retained"] as const;

/** A subscriber as the router reads it: no number. */
export interface SubscriberRow {
  id: string;
  lang: string;
}

export interface NewSubscriber {
  id: string;
  phone: string;
  lang: string;
  neighbourhoodId: string;
  groups: string[];
  consentVersion: string;
  startedBy: "web" | "staff";
}

/** One place row: a building, and one floor in it or none. */
export interface NewSubscriberPlace {
  id: string;
  rsn: string;
  floorId: string | null;
}

export const subscriberStore = {
  /** Whether the number is subscribed (the web sign-up's lookup): one select, whatever the answer. */
  async isSubscribed(executor: DbExecutor, phone: string): Promise<boolean> {
    const rows = await executor.select({ id: subscriber.id }).from(subscriber).where(eq(subscriber.phone, phone));
    return rows.length > 0;
  },

  /** The number's subscriber (id and language), or null. */
  async ofNumber(tx: DbTransaction, phone: string): Promise<SubscriberRow | null> {
    const [row] = await tx.select({ id: subscriber.id, lang: subscriber.lang }).from(subscriber).where(eq(subscriber.phone, phone));
    return row ?? null;
  },

  /** Locks the subscriber's row FOR UPDATE (the deletion's lock, after the deliveries': E07 "Deletion"); false when it is gone. */
  async lock(tx: DbTransaction, id: string): Promise<boolean> {
    const rows = await tx.select({ id: subscriber.id }).from(subscriber).where(eq(subscriber.id, id)).for("update");
    return rows.length > 0;
  },

  async insert(tx: DbTransaction, row: NewSubscriber): Promise<void> {
    await tx.insert(subscriber).values(row);
  },

  async insertPlaces(tx: DbTransaction, subscriberId: string, places: readonly NewSubscriberPlace[]): Promise<void> {
    if (places.length === 0) return;
    await tx.insert(subscriberPlace).values(places.map((place) => ({ ...place, subscriberId })));
  },

  /** One muted topic; false when the topic is not a disruption type (any more): the savepoint undoes only this insert. */
  async insertTopic(tx: DbTransaction, subscriberId: string, topic: string): Promise<boolean> {
    try {
      await tx.transaction(async (savepoint) => {
        await savepoint.insert(subscriberTopicOptout).values({ subscriberId, topic }).onConflictDoNothing();
      });
      return true;
    } catch (error) {
      if ((error as { code?: string; cause?: { code?: string } }).code === "23503" || (error as { cause?: { code?: string } }).cause?.code === "23503") return false;
      throw error;
    }
  },

  /** Deletes the subscriber; its places, muted topics and prompt go with it (ON DELETE CASCADE). */
  async delete(tx: DbTransaction, id: string): Promise<boolean> {
    const deleted = await tx.delete(subscriber).where(eq(subscriber.id, id)).returning({ id: subscriber.id });
    return deleted.length > 0;
  },

  /** The number of a receiving subscriber, for the resolver's source only; null when the subscriber is gone or does not receive texts. */
  async phoneOf(tx: DbTransaction, id: string): Promise<string | null> {
    const [row] = await tx
      .select({ phone: subscriber.phone })
      .from(subscriber)
      .where(and(eq(subscriber.id, id), inArray(subscriber.retentionState, [...RECEIVING_STATES])));
    return row?.phone ?? null;
  },

  /** The subscriber's open prompt that has not run out (by the database's clock), or null. */
  async openPrompt(tx: DbTransaction, subscriberId: string): Promise<string | null> {
    const [row] = await tx
      .select({ kind: smsPrompt.kind })
      .from(smsPrompt)
      .where(and(eq(smsPrompt.subscriberId, subscriberId), gt(smsPrompt.expiresAt, sql`now()`)));
    return row?.kind ?? null;
  },

  /** Opens a prompt, replacing any other, open for `ms` from the database's now(). */
  async openNewPrompt(tx: DbTransaction, subscriberId: string, kind: string, ms: number): Promise<void> {
    await tx.delete(smsPrompt).where(eq(smsPrompt.subscriberId, subscriberId));
    await tx.insert(smsPrompt).values({ subscriberId, kind, expiresAt: sql`now() + ${`${Math.trunc(ms)} milliseconds`}::interval` });
  },

  async clearPrompt(tx: DbTransaction, subscriberId: string): Promise<void> {
    await tx.delete(smsPrompt).where(eq(smsPrompt.subscriberId, subscriberId));
  },
};

export type SubscriberStore = typeof subscriberStore;
