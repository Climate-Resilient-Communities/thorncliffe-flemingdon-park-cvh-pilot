// The inbound router's own tables (S07.04): the MessageSid hashes that make a retried webhook do nothing, the daily keyword counts, the
// short-lived `inbound_reply` rows that hold a number with no subscription until its one reply is handed off, and the once-a-day limit of
// that reply (a keyed hash of the number in `rate_limit`, deleted after 24 hours), and S07.05's daily menu limit (the same kind of hash).
// Every statement runs in the caller's transaction.
import { and, count, eq, gt, gte, lt, sql } from "drizzle-orm";
import type { DbTransaction } from "../../../platform/db";
import { INBOUND_SCOPE } from "../domain/inbound";
import { inboundKeywordCount, inboundLimitedCount, inboundReply, inboundSeen, rateLimit } from "./schema";

/** The day a keyword is counted under: the date in Toronto, by the database's clock. */
const TORONTO_DAY = sql`(now() at time zone 'America/Toronto')::date`;

/** The scopes of the inbound limit's keyed hashes in `rate_limit` (S07.09): one row per counted message, and one row for a number that reached the limit. */
export const INBOUND_MUTE_SCOPE = "inbound_mute";

/** Midnight in Toronto that began today, by the database's clock. */
const TORONTO_DAY_START = sql`(date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto')`;

/** What the inbound limit decided for one message: counted and let through, the one that reached the limit, or one after it that day. */
export type InboundLimitResult = "allowed" | "reached" | "muted";

export const inboundStore = {
  /** Records the message as seen; false when it was seen before (a retry): then nothing else is done. */
  async markSeen(tx: DbTransaction, sidHash: string): Promise<boolean> {
    const inserted = await tx.insert(inboundSeen).values({ sidHash }).onConflictDoNothing().returning({ sidHash: inboundSeen.sidHash });
    return inserted.length > 0;
  },

  /** Adds one to today's count of the keyword. */
  async countKeyword(tx: DbTransaction, keyword: string): Promise<void> {
    await tx
      .insert(inboundKeywordCount)
      .values({ day: TORONTO_DAY as unknown as string, keyword, count: 1 })
      .onConflictDoUpdate({ target: [inboundKeywordCount.day, inboundKeywordCount.keyword], set: { count: sql`${inboundKeywordCount.count} + 1` } });
  },

  /**
   * The inbound limit (S07.09), by the database's clock, for a message that is not a deletion or an opt-out event. `hash` is the number's keyed
   * hash; the caller holds the number's lock, so two messages from one number cannot both take the last place. A number with a mute row from
   * today (Toronto) gets `muted`. Otherwise it is counted: with fewer than `perHour` counted messages in the last hour the message is counted
   * and `allowed`; at that many, this message is not counted, the number is muted for the rest of the day and the result is `reached`. A
   * `reached` or `muted` message is added to the day's count of unanswered messages (counts only). Old hashes are deleted as they pass 24 hours.
   */
  async limitInbound(tx: DbTransaction, hash: string, limit: { perHour: number; windowMs: number }): Promise<InboundLimitResult> {
    const mutes = await tx
      .select({ today: sql<boolean>`${rateLimit.at} >= ${TORONTO_DAY_START}` })
      .from(rateLimit)
      .where(and(eq(rateLimit.scope, INBOUND_MUTE_SCOPE), eq(rateLimit.clientHash, hash)));
    if (mutes.some((mute) => mute.today)) {
      await countLimited(tx, false);
      return "muted";
    }
    // A number muted on an earlier day starts the new day clean: its counted messages from before midnight do not count towards today's limit.
    const windowStart = sql`now() - ${limit.windowMs / 1000} * interval '1 second'`;
    const since = mutes.length > 0 ? sql`greatest(${windowStart}, ${TORONTO_DAY_START})` : windowStart;
    const [row] = await tx
      .select({ n: count() })
      .from(rateLimit)
      .where(and(eq(rateLimit.scope, INBOUND_SCOPE), eq(rateLimit.clientHash, hash), gt(rateLimit.at, since)));
    if ((row?.n ?? 0) >= limit.perHour) {
      await tx.insert(rateLimit).values({ scope: INBOUND_MUTE_SCOPE, clientHash: hash, at: sql`now()` as unknown as Date });
      await countLimited(tx, true);
      return "reached";
    }
    await tx.insert(rateLimit).values({ scope: INBOUND_SCOPE, clientHash: hash, at: sql`now()` as unknown as Date });
    await tx.delete(rateLimit).where(lt(rateLimit.at, sql`now() - interval '24 hours'`));
    return "allowed";
  },

  /**
   * The daily menu limit (S07.05, E07 "Menu"): a menu started by the number whose keyed hash is `hash` is counted under `scope` and
   * `allowed` when the number has started fewer than `perDay` today (Toronto, by the database's clock); otherwise nothing is counted and
   * the result is `limit`. The caller holds the number's lock, so two replies from one number cannot both take the last menu. The rows go
   * with every other `rate_limit` hash after 24 hours (S07.09's purge).
   */
  async startMenu(tx: DbTransaction, scope: string, hash: string, perDay: number): Promise<"allowed" | "limit"> {
    const [row] = await tx
      .select({ n: count() })
      .from(rateLimit)
      .where(and(eq(rateLimit.scope, scope), eq(rateLimit.clientHash, hash), gte(rateLimit.at, TORONTO_DAY_START)));
    if ((row?.n ?? 0) >= perDay) return "limit";
    await tx.insert(rateLimit).values({ scope, clientHash: hash, at: sql`now()` as unknown as Date });
    return "allowed";
  },

  /** A new `inbound_reply` row for the number: its id, its `expires_at` (30 minutes on) and the database's now() it was made at. */
  async insertReply(tx: DbTransaction, id: string, phone: string): Promise<{ id: string; expiresAt: Date; now: Date }> {
    const [row] = await tx.insert(inboundReply).values({ id, phone }).returning({ id: inboundReply.id, expiresAt: inboundReply.expiresAt, now: inboundReply.createdAt });
    return row!;
  },

  /** The ids of the number's `inbound_reply` rows (none is read back with its number). */
  async replyIdsOf(tx: DbTransaction, phone: string): Promise<string[]> {
    const rows = await tx.select({ id: inboundReply.id }).from(inboundReply).where(eq(inboundReply.phone, phone));
    return rows.map((row) => row.id);
  },

  async deleteReply(tx: DbTransaction, id: string): Promise<void> {
    await tx.delete(inboundReply).where(eq(inboundReply.id, id));
  },

  /**
   * The hand-off's take (E06 definitions, `inbound_reply`): the row is locked, its number read into memory and the row deleted, all in the
   * hand-off transaction. A row past its 30 minutes is deleted too and gives no number.
   */
  async takeReply(tx: DbTransaction, id: string): Promise<string | null> {
    // One statement locks the row, reads it and deletes it (a DELETE takes the row's lock, as FOR UPDATE would; the app's role may not update
    // the table, so it cannot lock it any other way).
    const [row] = await tx.delete(inboundReply).where(eq(inboundReply.id, id)).returning({ phone: inboundReply.phone, live: sql<boolean>`${inboundReply.expiresAt} > now()` });
    if (!row) return null;
    return row.live ? row.phone : null;
  },

  /**
   * The once-a-day limit of the sign-up link to one number (E07 "Reply to an unknown number"): true, and counted, when the number's keyed
   * hash has no row in the last 24 hours under `scope`; false otherwise. Old hashes are deleted as they pass 24 hours. The caller holds the
   * number's lock, so two messages from one number cannot both pass.
   */
  async allowOncePerDay(tx: DbTransaction, scope: string, hash: string): Promise<boolean> {
    const since = sql`now() - interval '24 hours'`;
    const seen = await tx
      .select({ id: rateLimit.id })
      .from(rateLimit)
      .where(and(eq(rateLimit.scope, scope), eq(rateLimit.clientHash, hash), gt(rateLimit.at, since)));
    if (seen.length > 0) return false;
    await tx.insert(rateLimit).values({ scope, clientHash: hash, at: sql`now()` as unknown as Date });
    await tx.delete(rateLimit).where(lt(rateLimit.at, since));
    return true;
  },
};

/** Adds one unanswered message to today's count, and one number when it is the one that reached the limit. */
async function countLimited(tx: DbTransaction, newNumber: boolean): Promise<void> {
  await tx
    .insert(inboundLimitedCount)
    .values({ day: TORONTO_DAY as unknown as string, messages: 1, numbers: newNumber ? 1 : 0 })
    .onConflictDoUpdate({
      target: inboundLimitedCount.day,
      set: { messages: sql`${inboundLimitedCount.messages} + 1`, numbers: newNumber ? sql`${inboundLimitedCount.numbers} + 1` : inboundLimitedCount.numbers },
    });
}

export type InboundStore = typeof inboundStore;
