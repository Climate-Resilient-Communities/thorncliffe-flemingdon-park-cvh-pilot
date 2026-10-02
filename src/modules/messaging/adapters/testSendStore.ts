import { and, eq, gt, sql } from "drizzle-orm";
import type { TestSendStore } from "../application/ports";
import { smsTestSend } from "./schema";

/**
 * The ledger of test sends with Drizzle, in the caller's transaction (every read goes through `tx`).
 *
 * Race safety: the claim first takes a transaction-scoped advisory lock keyed on the number's hash,
 * so two presses on the same number are serialised: the second waits for the first's claim to
 * commit, then finds it inside the window and is refused. A repeated request id is caught twice
 * over: by the read under the lock and by the unique key on request_id (the insert does nothing when
 * the id exists, which covers the same id arriving for two different numbers at once).
 */
export const drizzleTestSendStore: TestSendStore = {
  async claim(tx, claim) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"sms_test_send:" + claim.numberHash}, 0))`);

    const sameRequest = await tx.select({ id: smsTestSend.id }).from(smsTestSend).where(eq(smsTestSend.requestId, claim.requestId)).limit(1);
    if (sameRequest.length > 0) return { kind: "duplicate_request" };

    const recent = await tx
      .select({ id: smsTestSend.id })
      .from(smsTestSend)
      .where(and(eq(smsTestSend.numberHash, claim.numberHash), gt(smsTestSend.claimedAt, claim.windowStart)))
      .limit(1);
    if (recent.length > 0) return { kind: "duplicate_number" };

    const inserted = await tx
      .insert(smsTestSend)
      .values({ requestId: claim.requestId, staffAccountId: claim.staffId, numberHash: claim.numberHash, claimedAt: claim.claimedAt })
      .onConflictDoNothing({ target: smsTestSend.requestId })
      .returning({ id: smsTestSend.id });
    return inserted.length === 1 ? { kind: "claimed", id: inserted[0].id } : { kind: "duplicate_request" };
  },

  async complete(tx, id, result) {
    await tx
      .update(smsTestSend)
      .set({
        outcome: result.outcome,
        httpStatus: result.httpStatus,
        providerStatus: result.providerStatus,
        providerMessageId: result.messageId,
        providerErrorCode: result.errorCode,
        completedAt: result.completedAt,
      })
      .where(and(eq(smsTestSend.id, id), eq(smsTestSend.outcome, "pending")));
  },
};
