// A running thread as the rules see it (S05.01, AD-5, AD-19, epic E05 definitions): which entries residents can read, in what order, which one
// covers the thread, what an update starts from and what the thread's valid-until is. Pure: no I/O, no clock (the caller gives `now`).
//
// An update adds to an open thread and supersedes nothing: every earlier entry stays readable, in order, and the newest is the one that covers
// the thread (its audience is the thread's audience, its valid-until the thread's). The same rules serve the Hub's screens (the audience an update
// starts from), the approver's "Now also for" line, the expiry job (E05) and the resident reader (S04.08, S05.06), so they are written once here.
import type { Audience } from "../../../contracts/audience";
import { UNTIL_RESOLVED_MS, type Phase, type ValidUntilMode } from "./content";
import type { EntryKind, EntryStatus } from "./lifecycle";

/**
 * The kinds that tell residents what is going on: an acknowledgement, an update, a correction and a final. A withdrawal notice (human or
 * system) is never substantive (epic E05, Definitions), so it never covers a thread.
 */
export const SUBSTANTIVE_KINDS = ["ack", "update", "correction", "final"] as const satisfies readonly EntryKind[];

export const isSubstantive = (kind: EntryKind): boolean => (SUBSTANTIVE_KINDS as readonly string[]).includes(kind);

/** What the rules read of one entry of a thread. */
export interface ThreadEntryFacts {
  id: string;
  kind: EntryKind;
  status: EntryStatus;
  /** Set when residents can read the entry on the web: at approval (D-1 sets it at submit, E08). */
  webPublishedAt: Date | null;
  phase: Phase;
  validUntil: Date;
  validUntilMode: ValidUntilMode;
  audience: Audience;
  types: readonly string[];
}

/**
 * Whether residents can read the entry: it is web-published and was neither discarded nor never submitted. A superseded entry stays readable
 * (E05 shows it, marked); a draft has no publication time.
 */
export const isPublished = (entry: { status: string; webPublishedAt: Date | null }): boolean =>
  entry.webPublishedAt !== null && entry.status !== "draft" && entry.status !== "discarded";

/**
 * Newest first, by publication time, ties by id (UUIDv7 ids rise with creation): the order residents read a thread in. The input is not
 * changed. An entry with no publication time is not one residents read and comes last.
 */
export function newestFirst<T extends { id: string; webPublishedAt: Date | null }>(entries: readonly T[]): T[] {
  const time = (entry: T) => entry.webPublishedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  return [...entries].sort((a, b) => time(b) - time(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** The entries residents can read, newest first. */
export const readableEntries = <T extends ThreadEntryFacts>(entries: readonly T[]): T[] => newestFirst(entries.filter(isPublished));

/**
 * The covering entry: the latest published, non-superseded substantive entry (epic E05, Definitions). A thread covers a place when that
 * entry's audience covers it, and the thread's valid-until and status come from it. Null when residents have read nothing substantive yet
 * (an acknowledgement or alert still waiting for its approval).
 */
export function coveringEntry<T extends ThreadEntryFacts>(entries: readonly T[]): T | null {
  return readableEntries(entries).find((entry) => isSubstantive(entry.kind) && entry.status !== "superseded") ?? null;
}

/** The thread's valid-until: the covering entry's, so a later update's choice replaces an earlier one's; null when nothing covers the thread. */
export function threadValidUntil(entries: readonly ThreadEntryFacts[]): Date | null {
  return coveringEntry(entries)?.validUntil ?? null;
}

/**
 * Whether the thread is still an acknowledgement: every substantive entry residents can read is an `ack`. Its first update is "Promote to full
 * alert" (O-13); a thread that already has an update or a full alert of its own is added to with "Add an update" (O-14).
 */
export function isAckOnly(entries: readonly ThreadEntryFacts[]): boolean {
  const read = readableEntries(entries).filter((entry) => isSubstantive(entry.kind));
  return read.length > 0 && read.every((entry) => entry.kind === "ack");
}

/** What a new update starts with, taken from the entry that covers the thread. */
export interface UpdateStart {
  /** The thread's audience, carried over: an update changes it only by an author's choice. */
  audience: Audience;
  /** The thread's types, carried over (the audience holds the same list). */
  types: readonly string[];
  /** The covering entry's choice of valid-until: "until resolved" or a date and time. */
  validUntilMode: ValidUntilMode;
  /**
   * "Until resolved" renews to 24 elapsed hours from `now` (renewed by each update); a date and time starts as the covering entry's own, which may
   * have passed, in which case the author must choose another before the update can be saved.
   */
  validUntil: Date;
}

export function updateStart(covering: ThreadEntryFacts, now: Date): UpdateStart {
  return {
    audience: covering.audience,
    types: covering.types,
    validUntilMode: covering.validUntilMode,
    validUntil: covering.validUntilMode === "resolved" ? new Date(now.getTime() + UNTIL_RESOLVED_MS) : covering.validUntil,
  };
}
