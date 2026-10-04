// When a thread expires (S05.04, epic E05 "Thread expiry"). Pure: no I/O, no clock (the caller gives `now`, the database's).
//
// A thread expires when the valid-until of its covering entry (the latest published, non-superseded substantive entry) has passed and it has not been
// closed. "Until resolved" entries store the instant they run to (24 elapsed hours from the entry's own save, renewed by each update), so there is one rule:
// compare two instants. Never a wall-clock time, never a zone: the clocks changing on 8 March and 1 November 2026 cannot move an instant, and a valid-until
// typed in the repeated autumn hour was resolved to one instant when it was saved (platform/clock).
import { coveringEntry, type ThreadEntryFacts } from "./thread";

/** A thread closed later than this many minutes past its valid-until was missed by earlier runs: an ops event says so. */
export const EXPIRE_LATE_MINUTES = 5;

/** The decision for one open thread. `covering` null: nothing residents read covers it (an acknowledgement still waiting for its approval never expires). */
export type ExpiryDecision = { expired: true; covering: ThreadEntryFacts; lateMs: number } | { expired: false; covering: ThreadEntryFacts | null };

/** Whether the thread's covering entry is past its valid-until at `now`: the instant itself counts as past, as approval refuses a valid-until that is not ahead. */
export function expiryOf(entries: readonly ThreadEntryFacts[], now: Date): ExpiryDecision {
  const covering = coveringEntry(entries);
  if (covering === null) return { expired: false, covering: null };
  const lateMs = now.getTime() - covering.validUntil.getTime();
  return lateMs >= 0 ? { expired: true, covering, lateMs } : { expired: false, covering };
}

/** Whether a close this late shows that runs were missed. */
export const isLate = (lateMs: number): boolean => lateMs > EXPIRE_LATE_MINUTES * 60_000;
