// Corrections and withdrawals (S05.02, AD-5 "Supersession", epic E05 definitions): which entries can be corrected or withdrawn (a valid target), why a
// withdrawal is made (the catalog of reasons), and when a withdrawal leaves nothing that residents can still act on, so the thread closes `withdrawn`.
// Pure: no I/O, no clock. The use cases (../application/lifecycle.ts) ask here under the thread's lock; the entry trigger repeats the rules the data itself
// must keep (db/migrations/20261004030000_alert_corrections.sql), so a use case that forgot one is still refused.
import type { EntryKind, EntryStatus } from "./lifecycle";
import { isPublished, isSubstantive } from "./thread";

/**
 * Why a withdrawal is made, a fixed catalog (the Hub chooses one; "other" comes with the words the Hub writes). The same list is the database's CHECK
 * and the Hub's radios. A reason is a code, never text, so the audit trail can hold it.
 */
export const WITHDRAWAL_REASONS = ["wrong_place", "wrong_information", "duplicate", "other"] as const;
export type WithdrawalReason = (typeof WITHDRAWAL_REASONS)[number];

export const isWithdrawalReason = (value: unknown): value is WithdrawalReason => typeof value === "string" && (WITHDRAWAL_REASONS as readonly string[]).includes(value);

/** The kinds that name a target. */
export const SUPERSEDING_KINDS = ["correction", "withdrawal"] as const satisfies readonly EntryKind[];
export type SupersedingKind = (typeof SUPERSEDING_KINDS)[number];

export const isSupersedingKind = (kind: string): kind is SupersedingKind => (SUPERSEDING_KINDS as readonly string[]).includes(kind);

/** What the rules read of an entry that may be a target. */
export interface TargetFacts {
  id: string;
  kind: EntryKind;
  status: EntryStatus;
  /** Set when residents can read the entry. */
  webPublishedAt: Date | null;
}

/** Why an entry is not a valid target. `TARGET_NOT_VALID`: it is not an entry of this thread, or it is a withdrawal notice (nothing is corrected about a notice). */
export type TargetRefusal = "TARGET_NOT_VALID" | "TARGET_SUPERSEDED" | "TARGET_NOT_PUBLISHED";

/**
 * A valid target (epic E05, Definitions): an entry that is `approved`, or `pending_approval` and web-published (the D-1 case, E08), and not already
 * superseded. A correction itself can be corrected. An entry that is a draft, was discarded, or is still waiting for approval with nothing published is not
 * a target (`TARGET_NOT_PUBLISHED`: residents have read nothing of it); one that was corrected or withdrawn already is `TARGET_SUPERSEDED`. A thread that is
 * closed is judged before this (`ALERT_CLOSED`).
 */
export function targetRefusal(target: TargetFacts | null): TargetRefusal | null {
  if (target === null || target.kind === "withdrawal") return "TARGET_NOT_VALID";
  if (target.status === "superseded") return "TARGET_SUPERSEDED";
  if (target.status === "approved") return null;
  if (target.status === "pending_approval" && target.webPublishedAt !== null) return null;
  return "TARGET_NOT_PUBLISHED";
}

/** The entries of a thread that can be corrected or withdrawn now, in the order given. */
export function validTargets<T extends TargetFacts>(entries: readonly T[]): T[] {
  return entries.filter((entry) => targetRefusal(entry) === null);
}

/** What the rules read of a thread's entry to decide whether anything substantive remains. */
export interface RemainingFacts {
  id: string;
  kind: EntryKind;
  status: EntryStatus;
  webPublishedAt: Date | null;
}

/**
 * Whether a published, non-superseded substantive entry (`ack|update|correction|final`; a withdrawal notice never counts) remains once `superseded` entries
 * have been replaced: the thread stays open on it. `superseded` holds the targets of the approval being decided (their status is not yet changed in the rows
 * given, or already is: either way they do not count). The entry being approved is among the rows (it is published by then): a correction counts, the
 * withdrawal notice does not.
 */
export function substantiveRemains(entries: readonly RemainingFacts[], superseded: readonly string[]): boolean {
  return entries.some((entry) => isPublished(entry) && isSubstantive(entry.kind) && entry.status !== "superseded" && !superseded.includes(entry.id));
}

/**
 * The text of a withdrawal for the reason chosen. A reason from the catalog has fixed words (`catalogText`, the Hub's English catalog, which the text messages
 * and the web show in the resident's language through the entry's frozen translations); "other" is the words the Hub wrote. Control characters are taken out
 * and the ends trimmed before the use case checks it is there and short enough.
 */
export function withdrawalText(reason: WithdrawalReason, wording: string, catalogText: (reason: Exclude<WithdrawalReason, "other">) => string): string {
  const own = wording.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (reason === "other") return own;
  return catalogText(reason);
}
