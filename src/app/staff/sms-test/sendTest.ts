import { randomUUID } from "node:crypto";
import { englishText } from "@/i18n/text";
import type { SendTestTextOutcome, TestTextRefusal, TestTextService } from "@/modules/messaging";
import type { StaffSession } from "../session";

/**
 * What the "Send test text" form shows after a press. Every text is already resolved from the
 * catalog. `nextRequestId` is the request id of the next press: a press is one request, and a
 * repeated id is refused, so each answer hands the form a fresh one.
 */
export type SmsTestState =
  | { status: "idle" }
  | { status: "sent"; heading: string; lines: string[]; nextRequestId: string }
  | { status: "failed"; heading: string; lines: string[]; nextRequestId: string }
  | { status: "refused"; message: string; nextRequestId: string };

export interface SendTestDeps {
  service: () => Pick<TestTextService, "sendTestText" | "refuseNotAllowlisted">;
  /** The approved number behind the form's opaque choice, resolved on the server; undefined when it resolves to none. */
  resolveNumber: (choice: string) => string | undefined;
  newRequestId?: () => string;
}

const REFUSAL_KEYS: Record<TestTextRefusal, string> = {
  invalid: "staff.smsTest.errors.invalid",
  not_available: "staff.smsTest.errors.notAvailable",
  not_allowlisted: "staff.smsTest.errors.notAllowlisted",
  paused: "staff.smsTest.errors.paused",
  duplicate_number: "staff.smsTest.errors.duplicateNumber",
  duplicate_request: "staff.smsTest.errors.duplicateRequest",
};

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** The screen's words for the use case's answer: Twilio's status and message id, or its error code and message. */
export function describeOutcome(outcome: SendTestTextOutcome, nextRequestId: string): SmsTestState {
  switch (outcome.kind) {
    case "sent":
      return {
        status: "sent",
        heading: englishText("staff.smsTest.sent.heading"),
        lines: [
          englishText("staff.smsTest.sent.response", { http: outcome.httpStatus, status: outcome.status }),
          englishText("staff.smsTest.sent.messageId", { id: outcome.messageId }),
          englishText("staff.smsTest.sent.line"),
        ],
        nextRequestId,
      };
    case "provider_error": {
      const detail =
        outcome.message === null
          ? englishText("staff.smsTest.failed.bare", { http: outcome.httpStatus })
          : outcome.errorCode === null
            ? englishText("staff.smsTest.failed.withoutCode", { http: outcome.httpStatus, message: outcome.message })
            : englishText("staff.smsTest.failed.withCode", { code: outcome.errorCode, message: outcome.message });
      return { status: "failed", heading: englishText("staff.smsTest.failed.heading"), lines: [detail, englishText("staff.smsTest.failed.line")], nextRequestId };
    }
    case "no_answer":
      return { status: "failed", heading: englishText("staff.smsTest.noAnswer.heading"), lines: [englishText("staff.smsTest.noAnswer.line")], nextRequestId };
    case "refused":
      return { status: "refused", message: englishText(REFUSAL_KEYS[outcome.reason]), nextRequestId };
  }
}

/**
 * The "Send test text" server action's work for an Admin at aal2 (the guard, ../guard.ts, has
 * already refused everyone else). The form carries an opaque choice, never a number: it is resolved
 * here, on the server, from the approved numbers, and a choice that resolves to none (unknown,
 * tampered, a number typed in) is refused and audited before the ledger or Twilio is touched. A
 * resolved number goes with the request id to the messaging module, which checks the allowlist and
 * duplicates, calls Twilio once and audits the outcome.
 */
export async function sendTestFromForm(deps: SendTestDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<SmsTestState> {
  const nextRequestId = (deps.newRequestId ?? randomUUID)();
  let outcome: SendTestTextOutcome;
  try {
    const number = deps.resolveNumber(text(form, "number"));
    const service = deps.service();
    outcome = number === undefined ? await service.refuseNotAllowlisted(session.staffId) : await service.sendTestText({ actorStaffId: session.staffId, requestId: text(form, "requestId"), number });
  } catch {
    // Not configured here (no database, no environment), or the ledger failed: nothing was sent.
    return { status: "refused", message: englishText("staff.smsTest.errors.unavailable"), nextRequestId };
  }
  return describeOutcome(outcome, nextRequestId);
}

/** One line for each attempt whose answer was never recorded: its id and when it started (UTC), never a number. */
export function describeUnknownAttempts(attempts: readonly { id: number; claimedAt: Date }[]): string[] {
  return attempts.map(({ id, claimedAt }) => englishText("staff.smsTest.unknown.item", { id, time: claimedAt.toISOString().slice(0, 16).replace("T", " ") }));
}
