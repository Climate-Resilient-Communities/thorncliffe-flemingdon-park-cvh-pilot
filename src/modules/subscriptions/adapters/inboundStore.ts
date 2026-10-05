// The inbound router's own tables (S07.04): the MessageSid hashes that make a retried webhook do nothing, the daily keyword counts, the
// short-lived `inbound_reply` rows that hold a number with no subscription until its one reply is handed off, and the once-a-day limit of
// that reply (a keyed hash of the number in `rate_limit`, deleted after 24 hours). Every statement runs in the caller's transaction.
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { DbTransaction } from "../../../platform/db";
import { inboundKeywordCount, inboundReply, inboundSeen, rateLimit } from "./schema";

/** The day a keyword is counted under: the date in Toronto, by the database's clock. */
const TORONTO_DAY = sql`(now() at time zone 'America/Toronto')::date`;

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

export type InboundStore = typeof inboundStore;
