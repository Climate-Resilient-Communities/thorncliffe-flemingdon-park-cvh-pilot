// The statements of subscribers and their prompts (S07.04; S07.05's menus change the language, the places and the neighbourhood, and keep
// their page in the prompt's step). Every one runs in the caller's transaction. The number is selected only by
// `phoneOf` (the ContactResolver's source, at the hand-off point, and S07.06's deletion, which deletes by number); the router and the web
// sign-up find a subscriber by number and read back its id, language and prompt, never the number; S07.06's edit page reads its last two
// digits only.
import { and, countDistinct, eq, gt, sql } from "drizzle-orm";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { receivingSql } from "./campaignStore";
import { smsPrompt, subscriber, subscriberPlace, subscriberTopicOptout } from "./schema";

/**
 * The retention states that can receive texts (E07 "Matching subscribers"). Which of them do now is `receivingSql` (campaignStore.ts, S09.07): a
 * `reconsent_pending` subscriber receives only until the campaign's deadline. Every query that selects receiving subscribers uses that one condition.
 */
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

/** The subscriber's row locked FOR NO KEY UPDATE, an edit's lock (`subscriberStore.lockForEdit`); false when it is gone. */
async function lockForEdit(tx: DbTransaction, id: string): Promise<boolean> {
  const rows = await tx.select({ id: subscriber.id }).from(subscriber).where(eq(subscriber.id, id)).for("no key update");
  return rows.length > 0;
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

  /**
   * Locks the subscriber's row FOR NO KEY UPDATE, an edit's lock (S07.05's menus, S07.06's page); false when it is gone. It waits for an approval that holds
   * the row FOR SHARE while capturing recipients (S07.07), but not for a resend's FOR KEY SHARE (`receivesShared`), which only a deletion's
   * FOR UPDATE stops: a resident changing their building is still receiving. It is the lock the campaign's start takes on every `active`
   * subscriber (`campaignStore.lockActive`, S09.07) and `openNewPrompt` takes before it writes a prompt, so these wait for one another.
   */
  lockForEdit,

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
      .where(and(eq(subscriber.id, id), receivingSql(subscriber.retentionState)));
    return row?.phone ?? null;
  },

  /**
   * Whether the subscriber exists and is in a receiving state, their row locked `FOR KEY SHARE` (it conflicts only with a deletion, not an ordinary update) for the caller's transaction (no number is read). The lock is taken
   * without waiting (`SKIP LOCKED`): a row someone holds `FOR UPDATE` is being deleted (STOP, reply 0), which reads as "does not receive", so a resend never waits
   * on a deletion that is itself waiting for the delivery rows the resend holds. An edit's lock (`lockForEdit`) does not conflict with it.
   */
  async receivesShared(tx: DbTransaction, id: string): Promise<boolean> {
    const rows = await tx
      .select({ id: subscriber.id })
      .from(subscriber)
      .where(and(eq(subscriber.id, id), receivingSql(subscriber.retentionState)))
      .for("key share", { skipLocked: true });
    return rows.length > 0;
  },

  /**
   * Whether the subscriber exists and is in a receiving state (`phoneOf`'s and `receivesShared`'s predicate, `receivingSql`: a `reconsent_pending`
   * subscriber past the campaign's deadline does not receive, S09.07), read without a lock: S07.06's read-only view, which takes no lock and waits
   * for none, so a row someone holds for an edit (a menu's save, a change from another tab, the campaign's start) is read as it was. No number is read.
   */
  async receives(executor: DbExecutor, id: string): Promise<boolean> {
    const rows = await executor
      .select({ id: subscriber.id })
      .from(subscriber)
      .where(and(eq(subscriber.id, id), receivingSql(subscriber.retentionState)));
    return rows.length > 0;
  },

  /** The subscriber's open prompt that has not run out (by the database's clock), or null. */
  async openPrompt(tx: DbTransaction, subscriberId: string): Promise<string | null> {
    const [row] = await tx
      .select({ kind: smsPrompt.kind })
      .from(smsPrompt)
      .where(and(eq(smsPrompt.subscriberId, subscriberId), gt(smsPrompt.expiresAt, sql`now()`)));
    return row?.kind ?? null;
  },

  /**
   * The subscriber's prompt that has not run out (by the database's clock), or null: its kind, its step (S07.05's menu page), and whether
   * it is idle, its message sent `idleMs` or more ago (a menu's row outlives its 10 minutes so that a late reply can be told it reset).
   */
  async promptOf(tx: DbTransaction, subscriberId: string, idleMs: number): Promise<{ kind: string; step: unknown; idle: boolean } | null> {
    const [row] = await tx
      .select({ kind: smsPrompt.kind, step: smsPrompt.step, idle: sql<boolean>`${smsPrompt.sentAt} <= now() - ${`${Math.trunc(idleMs)} milliseconds`}::interval` })
      .from(smsPrompt)
      .where(and(eq(smsPrompt.subscriberId, subscriberId), gt(smsPrompt.expiresAt, sql`now()`)));
    return row ?? null;
  },

  /**
   * Opens a prompt, replacing any other, open for `ms` from the database's now(), with its own state (`step`, S07.05's menu page). The subscriber's row
   * is locked first with an edit's lock (`FOR NO KEY UPDATE`, `lockForEdit`; AD-18: the subscriber row before what hangs on it), so this waits for a
   * campaign's start that holds it and then replaces the re-consent prompt the start committed, and a start waits for this and then replaces this
   * prompt: neither finds the other's uncommitted row in `sms_prompt`'s primary key (S09.07). Every writer of a prompt (the router's deletion
   * confirmation, S07.05's menu pages and the edit link's offer) opens it here, and `clearPrompt` closes one in the same order.
   */
  async openNewPrompt(tx: DbTransaction, subscriberId: string, kind: string, ms: number, step: Record<string, unknown> = {}): Promise<void> {
    await lockForEdit(tx, subscriberId);
    await tx.delete(smsPrompt).where(eq(smsPrompt.subscriberId, subscriberId));
    await tx.insert(smsPrompt).values({ subscriberId, kind, step, expiresAt: sql`now() + ${`${Math.trunc(ms)} milliseconds`}::interval` });
  },

  /** How many buildings the subscriber has saved (distinct buildings: a building with two floors is one). */
  async savedBuildingCount(tx: DbTransaction, subscriberId: string): Promise<number> {
    const [row] = await tx.select({ n: countDistinct(subscriberPlace.rsn) }).from(subscriberPlace).where(eq(subscriberPlace.subscriberId, subscriberId));
    return row?.n ?? 0;
  },

  /** Replaces every saved place of the subscriber with these (S07.05's menu 1). The caller holds the subscriber's row lock (`lockForEdit`). */
  async replacePlaces(tx: DbTransaction, subscriberId: string, places: readonly NewSubscriberPlace[]): Promise<void> {
    await tx.delete(subscriberPlace).where(eq(subscriberPlace.subscriberId, subscriberId));
    if (places.length > 0) await tx.insert(subscriberPlace).values(places.map((place) => ({ ...place, subscriberId })));
  },

  /** Sets the subscriber's language (menu 2) or neighbourhood (menu 1); the caller holds the subscriber's row lock (`lockForEdit`). */
  async setLang(tx: DbTransaction, subscriberId: string, lang: string): Promise<void> {
    await tx.update(subscriber).set({ lang }).where(eq(subscriber.id, subscriberId));
  },

  async setNeighbourhood(tx: DbTransaction, subscriberId: string, neighbourhoodId: string): Promise<void> {
    await tx.update(subscriber).set({ neighbourhoodId }).where(eq(subscriber.id, subscriberId));
  },

  /**
   * Closes the subscriber's prompt. Like `openNewPrompt`, it locks the subscriber's row first (`lockForEdit`; AD-18): the router clears an idle menu
   * and then opens a new menu's page, and a campaign's start that took the row between the two would otherwise wait for this prompt while this
   * waits for the row (a deadlock, S09.07).
   */
  async clearPrompt(tx: DbTransaction, subscriberId: string): Promise<void> {
    await lockForEdit(tx, subscriberId);
    await tx.delete(smsPrompt).where(eq(smsPrompt.subscriberId, subscriberId));
  },

  /**
   * S07.06: what the edit page shows of a subscriber: its language, neighbourhood, groups, places (one row per building and floor, a null
   * floor for none recorded there) and muted topics, and the last two digits of its number (cut in the database: the whole number is
   * never read). Null when the subscriber is gone.
   */
  async editView(tx: DbTransaction, id: string): Promise<SubscriberEditView | null> {
    const [row] = await tx
      .select({ lang: subscriber.lang, neighbourhoodId: subscriber.neighbourhoodId, groups: subscriber.groups, phoneLast2: sql<string>`right(${subscriber.phone}, 2)` })
      .from(subscriber)
      .where(eq(subscriber.id, id));
    if (!row) return null;
    const places = await tx.select({ rsn: subscriberPlace.rsn, floorId: subscriberPlace.floorId }).from(subscriberPlace).where(eq(subscriberPlace.subscriberId, id));
    const topics = await tx.select({ topic: subscriberTopicOptout.topic }).from(subscriberTopicOptout).where(eq(subscriberTopicOptout.subscriberId, id));
    return { ...row, places, mutedTopics: topics.map((topic) => topic.topic) };
  },

  /** Sets the subscriber's groups (S07.06's page); the caller holds the subscriber's row lock (`lockForEdit`). */
  async setGroups(tx: DbTransaction, subscriberId: string, groups: readonly string[]): Promise<void> {
    await tx.update(subscriber).set({ groups: [...groups] }).where(eq(subscriber.id, subscriberId));
  },

  /** Replaces the subscriber's muted topics with these (S07.06's page); the caller holds the subscriber's row lock (`lockForEdit`). */
  async replaceTopics(tx: DbTransaction, subscriberId: string, topics: readonly string[]): Promise<void> {
    await tx.delete(subscriberTopicOptout).where(eq(subscriberTopicOptout.subscriberId, subscriberId));
    if (topics.length > 0) await tx.insert(subscriberTopicOptout).values(topics.map((topic) => ({ subscriberId, topic })));
  },
};

/** A subscriber as the edit page shows it (S07.06): no number but its last two digits. */
export interface SubscriberEditView {
  lang: string;
  neighbourhoodId: string;
  groups: string[];
  phoneLast2: string;
  places: { rsn: string; floorId: string | null }[];
  mutedTopics: string[];
}

export type SubscriberStore = typeof subscriberStore;
