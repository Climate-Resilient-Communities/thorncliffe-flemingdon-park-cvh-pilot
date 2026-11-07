// The rules of a resident's place suggestion and the Hub's decision on it (PRD §6.3, D9/E4; prototype R-21, O-08 to O-10), without I/O or a
// clock: the reference code made from random bytes the caller draws, the one-way states (pending, then accepted or declined, once; an accepted
// one applied to the catalogue once), what the queue flags for the reviewer, and how long a suggestion has waited against the week residents
// are promised (R-21 "About a week").
import { REF_ALPHABET, type CostAnswer, type SubmissionStatus } from "@/contracts/placeSubmission";

/** How many characters a reference code has (two groups of four). */
const REF_LENGTH = 8;

/**
 * A reference code from at least eight random bytes: each byte picks a character of the 30-character alphabet. 256 is not a multiple of 30,
 * so the first 16 characters are a little likelier (9 in 256 against 8 in 256); with 30^8 codes that leaves far more than enough to guess.
 */
export function makeRef(bytes: Uint8Array): string {
  if (bytes.length < REF_LENGTH) throw new RangeError("makeRef needs eight random bytes");
  let letters = "";
  for (let i = 0; i < REF_LENGTH; i += 1) letters += REF_ALPHABET[bytes[i]! % REF_ALPHABET.length];
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

export type ReviewError = "not_found" | "already_decided";
export type ApplyError = "not_found" | "not_accepted" | "already_applied";

/** A suggestion is accepted or declined only while it waits: the first decision stands (two reviewers at once: the second is told). */
export function decideReview(state: { status: SubmissionStatus } | null): { ok: true } | { ok: false; error: ReviewError } {
  if (!state) return { ok: false, error: "not_found" };
  if (state.status !== "pending") return { ok: false, error: "already_decided" };
  return { ok: true };
}

/** "Done" on the Providers page: only an accepted suggestion, and only once. */
export function decideApply(state: { status: SubmissionStatus; appliedAt: Date | null } | null): { ok: true } | { ok: false; error: ApplyError } {
  if (!state) return { ok: false, error: "not_found" };
  if (state.status !== "accepted") return { ok: false, error: "not_accepted" };
  if (state.appliedAt !== null) return { ok: false, error: "already_applied" };
  return { ok: true };
}

/** What the queue marks on a suggestion before the reviewer opens it (O-08's flags): nothing is decided by them. */
export type SubmissionFlag = "noCat" | "fee" | "lowCost" | "words";

/**
 * Words that suggest selling (the marketplace rule, x03.market): a price, paying, a sale or a discount. English only: the Hub reads the
 * original beside it, and a flag only asks the reviewer to look.
 */
const MONEY_WORDS = /\$|\bprices?\b|\bpay(ing|ment)?\b|\bsale\b|\bsell(ing|s)?\b|\bdiscounts?\b|%\s*off\b|\bdeals?\b/i;

export function submissionFlags(submission: { kind: "add" | "correct"; category: string | null; cost: CostAnswer | null; name: string; what: string | null }): SubmissionFlag[] {
  if (submission.kind !== "add") return [];
  const flags: SubmissionFlag[] = [];
  if (submission.category === null) flags.push("noCat");
  if (submission.cost === "fee") flags.push("fee");
  if (submission.cost === "low") flags.push("lowCost");
  if (MONEY_WORDS.test(`${submission.name} ${submission.what ?? ""}`)) flags.push("words");
  return flags;
}

/** The week residents are told (R-21): a suggestion is due seven days after it was sent. */
export const REVIEW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since it was sent (0 on the day). */
export function waitedDays(sentAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - sentAt.getTime()) / DAY_MS));
}

/** Where a waiting suggestion stands against the week: due in some days, due tomorrow or today, or overdue by some days. */
export type Due = { kind: "dueIn"; days: number } | { kind: "dueTomorrow" } | { kind: "dueToday" } | { kind: "overdue"; days: number };

export function dueOf(waited: number): Due {
  const left = REVIEW_DAYS - waited;
  if (left > 1) return { kind: "dueIn", days: left };
  if (left === 1) return { kind: "dueTomorrow" };
  if (left === 0) return { kind: "dueToday" };
  return { kind: "overdue", days: -left };
}
