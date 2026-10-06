// The rules of a mark (S08.07, AD-12; E08 definitions "Marks", "Late mark", "Closed stub", "Escalation"). Pure: no I/O, no clock (the row's
// state, and whether a stub has expired, are read by the database at the time of the mark).
import type { MarkStatus } from "../../../contracts/checkinRound";

/** How long a closed stub is kept, and so takes a late mark: 2 hours after it closed (E08 "Closed stub"; the purge job deletes it then). */
export const STUB_LIFETIME_HOURS = 2;
/** How many mark ids a row keeps (the latest): enough for any row, so a mark sent again is always recognised. */
export const MARK_IDS_KEPT = 50;

/** A row as a mark finds it, under the row's lock. */
export interface MarkTarget {
  /** Live: it names its subscriber and is not tallied (an open round). Otherwise it has left its round: a closed stub, or (S08.08) a row kept for the Hub. */
  live: boolean;
  /** A stub closed more than STUB_LIFETIME_HOURS ago (not purged yet): it takes no mark. */
  expired: boolean;
  /** The ids of the marks already applied to it. */
  markIds: readonly string[];
}

/**
 * What a mark does:
 *  - `already`: its id was applied before: nothing changes (a mark sent again after a lost answer, even once the row has left its round);
 *  - `mark`: a live row takes it as its latest mark (and, for `not_reached` or `needs_help`, an escalation unless one exists for that status);
 *  - `escalate`: a late `not_reached` or `needs_help` on a row that has left its round and not expired: one escalation per status, nothing else;
 *  - `ended`: a late `done`: "This request has ended", nothing changes;
 *  - `round_ended`: no such row (never was, or purged), or a stub that expired: refused, nothing recorded against the round.
 */
export type MarkDecision = "already" | "mark" | "escalate" | "ended" | "round_ended";

export function decideMark(target: MarkTarget | null, mark: { id: string; status: MarkStatus }): MarkDecision {
  if (target === null) return "round_ended";
  if (target.markIds.includes(mark.id)) return "already";
  if (target.live) return "mark";
  if (target.expired) return "round_ended";
  return mark.status === "done" ? "ended" : "escalate";
}

/** Whether a mark tells the Hub (E08 "Escalation"): not reached and needs help do; done does not. */
export const escalates = (status: MarkStatus): status is "not_reached" | "needs_help" => status !== "done";
