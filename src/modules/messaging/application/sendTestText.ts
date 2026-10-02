// "Send test text" (S01.15, the first-text spike): an Admin sends one text, "CVH test from
// production", to a number on SMS_TEST_ALLOWLIST, to learn in week one whether the Twilio account
// and the toll-free number work. E06's outbound queue replaces this.
//
// The order is the safety:
//  1. refuse what is malformed, what is not production-live and configured, and what is not on the
//     allowlist: none of that calls the provider or touches the ledger;
//  2. claim the send in the ledger, in a transaction that holds an advisory lock on the number: a
//     repeated request id, or a claim on the same number in the last 5 minutes, is refused as a
//     duplicate. The claim commits before the provider is called, so a crash after it still blocks
//     a second text, and two presses at once send at most one;
//  3. call the provider once, never retrying;
//  4. record the answer on the claim and, for an accepted text, the `sms.test_sent` audit record in
//     the same transaction; for a provider error or no answer, the audit record is the refusal
//     `provider_error`.
// The audit trail never holds the number, the text or the provider's error message: the status, the
// HTTP status, the message id (a Twilio SID) and Twilio's numeric error code only.
import { createHmac } from "node:crypto";
import type { Db, DbTransaction } from "../../../platform/db";
import type { AuditEvent } from "../../audit";
import {
  AUDIT_REASON_OF,
  DUPLICATE_WINDOW_MS,
  TEST_TEXT_BODY,
  isAllowlisted,
  isE164,
  isRequestId,
  type TestTextRefusal,
} from "../domain/testText";
import type { ProviderAnswer, SmsProvider, TestSendStore } from "./ports";

/** Where the use case writes audit records: the audit module's `record` and `recordRefusal`. */
export interface TestTextAudit {
  record(tx: DbTransaction, event: AuditEvent<"sms.test_sent">): Promise<void>;
  recordRefusal(db: Db, event: AuditEvent<"sms.test_sent">): Promise<void>;
}

/**
 * What the use case needs to know about where it runs (src/app/staff/sms-test composes it from the
 * validated environment). `live` is true only in production with SMS_MODE=live; the Twilio account
 * and the from-number are present only where the credentials are.
 */
export interface TestTextConfig {
  live: boolean;
  allowlist: readonly string[];
  /** The verified toll-free number the text comes from; absent when Twilio is not set up. */
  fromNumber?: string;
}

export interface TestTextDeps {
  db: Db;
  store: TestSendStore;
  /** Absent when Twilio's credentials are not set (the use case then refuses as `not_available`). */
  provider?: SmsProvider;
  audit: TestTextAudit;
  config: TestTextConfig;
  /** The server-only key the number's hash is made with (derived from a secret; never stored). */
  numberKey: string;
  now?: () => Date;
}

export interface SendTestTextInput {
  actorStaffId: string;
  requestId: string;
  number: string;
}

/** What the screen shows: the provider's answer, or why nothing (or nothing more) was sent. */
export type SendTestTextOutcome =
  | { kind: "sent"; httpStatus: number; status: string; messageId: string }
  | { kind: "provider_error"; httpStatus: number; errorCode: number | null; message: string | null }
  | { kind: "no_answer" }
  | { kind: "refused"; reason: TestTextRefusal };

export interface TestTextService {
  sendTestText(input: SendTestTextInput): Promise<SendTestTextOutcome>;
}

const SUBJECT_TYPE = "sms_test_send";

/** The keyed hash of a number the ledger holds (HMAC-SHA-256, hex): the number itself is never stored. */
export function numberHash(key: string, number: string): string {
  return createHmac("sha256", key).update(number).digest("hex");
}

/** The ledger's key from a server-only secret (the Twilio auth token): a labelled HMAC, so no new secret is needed. */
export function numberKeyFromSecret(secret: string): string {
  return createHmac("sha256", secret).update("cvh:sms-test-send:v1").digest("hex");
}

export function createTestTextService(deps: TestTextDeps): TestTextService {
  const { db, store, provider, audit, config, numberKey } = deps;
  const now = deps.now ?? (() => new Date());

  async function refuse(actorStaffId: string, reason: TestTextRefusal): Promise<SendTestTextOutcome> {
    await audit.recordRefusal(db, {
      action: "sms.test_sent",
      actorStaffId,
      subjectType: SUBJECT_TYPE,
      subjectId: null,
      meta: { reason: AUDIT_REASON_OF[reason] },
    });
    return { kind: "refused", reason };
  }

  /** Records the provider's answer on the claim and in the audit trail. */
  async function settle(id: number, actorStaffId: string, answer: ProviderAnswer): Promise<void> {
    const completedAt = now();
    if (answer.kind === "accepted") {
      // The accepted text's ledger update and its `sms.test_sent` record commit together.
      await db.transaction(async (tx) => {
        await store.complete(tx, id, {
          outcome: "sent",
          httpStatus: answer.httpStatus,
          providerStatus: answer.status,
          messageId: answer.messageId,
          errorCode: null,
          completedAt,
        });
        await audit.record(tx, {
          action: "sms.test_sent",
          actorStaffId,
          subjectType: SUBJECT_TYPE,
          subjectId: answer.messageId,
          meta: { http_status: answer.httpStatus, provider_status: answer.status },
        });
      });
      return;
    }
    const rejected = answer.kind === "rejected";
    await db.transaction((tx) =>
      store.complete(tx, id, {
        outcome: rejected ? "failed" : "unknown",
        httpStatus: rejected ? answer.httpStatus : null,
        providerStatus: null,
        messageId: null,
        errorCode: rejected ? answer.errorCode : null,
        completedAt,
      }),
    );
    await audit.recordRefusal(db, {
      action: "sms.test_sent",
      actorStaffId,
      subjectType: SUBJECT_TYPE,
      subjectId: String(id),
      meta: {
        reason: "provider_error",
        ...(rejected ? { http_status: answer.httpStatus } : {}),
        ...(rejected && answer.errorCode !== null ? { provider_error_code: answer.errorCode } : {}),
      },
    });
  }

  return {
    async sendTestText({ actorStaffId, requestId, number }) {
      if (!isRequestId(requestId) || !isE164(number)) return refuse(actorStaffId, "invalid");
      const from = config.fromNumber;
      if (!config.live || !provider || !from) return refuse(actorStaffId, "not_available");
      if (!isAllowlisted(config.allowlist, number)) return refuse(actorStaffId, "not_allowlisted");

      const claimedAt = now();
      const claim = await db.transaction((tx) =>
        store.claim(tx, {
          requestId,
          staffId: actorStaffId,
          numberHash: numberHash(numberKey, number),
          claimedAt,
          windowStart: new Date(claimedAt.getTime() - DUPLICATE_WINDOW_MS),
        }),
      );
      if (claim.kind !== "claimed") return refuse(actorStaffId, claim.kind);

      const answer = await provider.send({ to: number, from, body: TEST_TEXT_BODY }).catch(() => ({ kind: "unreachable" as const }));

      // The text has gone (or not): from here the screen shows the provider's answer even if recording
      // it fails, since "nothing was sent" would be untrue. The claim stays `pending`, which still
      // blocks a second text to the number for 5 minutes.
      try {
        await settle(claim.id, actorStaffId, answer);
      } catch {
        // Recording failed; the audit module logs its own failures.
      }
      if (answer.kind === "accepted") return { kind: "sent", httpStatus: answer.httpStatus, status: answer.status, messageId: answer.messageId };
      if (answer.kind === "rejected") return { kind: "provider_error", httpStatus: answer.httpStatus, errorCode: answer.errorCode, message: answer.message };
      return { kind: "no_answer" };
    },
  };
}

