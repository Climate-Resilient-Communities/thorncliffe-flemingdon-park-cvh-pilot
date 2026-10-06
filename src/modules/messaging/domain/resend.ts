// The rules of a resend (S09.02, AR-21, E09 definitions "Resend"), pure: no I/O, no clock. A resend is a deliberate Admin action that creates a new delivery
// copying an earlier one of the same chain; the chain's first delivery is its root, a chain has at most two resends in total whichever row is resent, and no row
// of the chain ever changes. The database enforces what it can (migration 20261006120000_resend.sql: the copy, the key `resend:{root}:{n}`, the next number, the
// unique `(resend_of, resend_n)`, the latest text of the chain being one that did not arrive); this is the use case's reading of the same rules, which tells the
// Admin why a resend was refused before the database would.
import type { DeliveryState } from "./deliveryState";
import { problemMeaning, type ProblemMeaning } from "./sendingProgress";

/** A chain has at most this many resends in total, whichever row of it is resent. */
export const RESEND_LIMIT = 2;
/** The most chains one "resend all" handles; the answer says when there are more, and pressing again takes the next ones. */
export const BULK_RESEND_LIMIT = 1000;

/** The states of a text that can be resent: it did not arrive, or its outcome is unknown. */
export const RESENDABLE_STATES = ["failed", "undelivered", "unknown"] as const satisfies readonly DeliveryState[];
/** The states "resend all" takes. An `unknown` text is never part of it: it may already have arrived, so each is resent on its own, confirmed. */
export const BULK_RESEND_STATES = ["failed", "undelivered"] as const satisfies readonly DeliveryState[];

/** The idempotency key of a resend: the chain's root and which resend of it this is (S09.04's weekly review reads it). */
export const resendKey = (rootId: string, n: number): string => `resend:${rootId}:${n}`;

/** The provider errors that say the number cannot receive texts: a resend would only fail again, or text a person who asked for no more. */
export const UNRECEIVABLE_MEANINGS = ["not_in_service", "invalid_number", "landline", "opted_out"] as const satisfies readonly ProblemMeaning[];

/**
 * Why a resend was refused (each is also an audit refusal reason):
 *  - `not_found`: no such text of this entry;
 *  - `not_resendable`: the text is not one that failed, was undelivered or is unknown (it arrived, was cancelled or skipped, or is still on its way), or it is not a
 *    text to a resident (a drill's texts have their own view);
 *  - `status_changed`: the Admin confirmed a resend of a text they saw as one status and it is another now (a late callback resolved an `unknown` text);
 *  - `confirm_needed`: an `unknown` text is resent only with the Admin's confirmation that it may arrive twice;
 *  - `resend_limit`: the chain already has two resends;
 *  - `already_resent`: the text is not the chain's latest (a newer one was made for it), so resending it would send the same text twice;
 *  - `cannot_receive`: the provider's error says the number cannot receive texts (invalid number, opted out, ...);
 *  - `recipient_gone`: the resident was deleted or opted out, so the text has no recipient;
 *  - `recipient_not_receiving`: the resident no longer receives alerts (their state, or the re-consent deadline);
 *  - `not_sendable`: the alert's rules would not send it now (the entry was superseded or discarded, the alert was closed, its valid-until has passed).
 */
export const RESEND_REFUSALS = [
  "not_found",
  "not_resendable",
  "status_changed",
  "confirm_needed",
  "resend_limit",
  "already_resent",
  "cannot_receive",
  "recipient_gone",
  "recipient_not_receiving",
  "not_sendable",
] as const;
export type ResendRefusal = (typeof RESEND_REFUSALS)[number];

/** One row of a chain as the decision reads it. `resendN` is null on the root. */
export interface ChainText {
  id: string;
  state: DeliveryState;
  resendN: number | null;
  providerErrorCode: number | null;
  attempts: number;
}

export interface ResendFacts {
  /** The text the Admin chose, or the latest text of the chain "resend all" found. */
  target: string;
  /** The whole chain: the root and its resends. */
  chain: readonly ChainText[];
  /** The root's recipient; null once the resident was deleted. */
  recipientId: string | null;
  /** Whether the recipient is a resident of the real alert (`subscriber`); a drill's roster member is not. */
  recipientIsSubscriber: boolean;
  /** The status the Admin saw (single resend: always given, the form is refused without it), or null for "resend all", which shows none and takes no `unknown` text. */
  seen: string | null;
  /** Whether the Admin confirmed that an `unknown` text may already have arrived. */
  confirmedUnknown: boolean;
}

export type ResendDecision =
  | { ok: true; next: number }
  | { ok: false; reason: ResendRefusal; /** The text's status now, when the reason is about it. */ status?: DeliveryState; /** Why the number cannot receive texts. */ meaning?: ProblemMeaning };

const numberOf = (text: ChainText): number => text.resendN ?? 0;

/** The latest text of a chain: the highest resend number, the root when it has none. */
export function latestOf(chain: readonly ChainText[]): ChainText | null {
  return chain.reduce<ChainText | null>((latest, text) => (latest === null || numberOf(text) > numberOf(latest) ? text : latest), null);
}

/** What a failed or undelivered text's provider error says about the number, when it says the number cannot receive texts. */
export function unreceivableMeaning(text: Pick<ChainText, "state" | "providerErrorCode" | "attempts">): ProblemMeaning | null {
  if (text.state !== "failed" && text.state !== "undelivered") return null;
  const { meaning } = problemMeaning({ state: text.state, providerErrorCode: text.providerErrorCode, attempts: text.attempts });
  return (UNRECEIVABLE_MEANINGS as readonly string[]).includes(meaning) ? meaning : null;
}

/**
 * Whether one text may be resent, judged on the chain read under the root's lock. The order is the order an Admin should hear it in: what the text is, then what
 * the Admin saw, then the limit, then the number, then the confirmation an `unknown` text needs.
 */
export function decideResend(facts: ResendFacts): ResendDecision {
  const target = facts.chain.find((text) => text.id === facts.target);
  if (!target) return { ok: false, reason: "not_found" };
  if (facts.recipientId === null) return { ok: false, reason: "recipient_gone" };
  if (!facts.recipientIsSubscriber) return { ok: false, reason: "not_resendable", status: target.state };
  if (facts.seen !== null && facts.seen !== target.state) return { ok: false, reason: "status_changed", status: target.state };
  if (!(RESENDABLE_STATES as readonly string[]).includes(target.state)) return { ok: false, reason: "not_resendable", status: target.state };
  const latest = latestOf(facts.chain);
  if (latest !== null && latest.id !== target.id) return { ok: false, reason: "already_resent", status: latest.state };
  const resends = facts.chain.filter((text) => text.resendN !== null).length;
  if (resends >= RESEND_LIMIT) return { ok: false, reason: "resend_limit" };
  for (const text of facts.chain) {
    const meaning = unreceivableMeaning(text);
    if (meaning !== null) return { ok: false, reason: "cannot_receive", meaning };
  }
  if (target.state === "unknown" && !facts.confirmedUnknown) return { ok: false, reason: "confirm_needed", status: "unknown" };
  return { ok: true, next: resends + 1 };
}
