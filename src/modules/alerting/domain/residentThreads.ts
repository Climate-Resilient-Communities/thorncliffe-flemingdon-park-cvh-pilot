// The open threads the feed tells residents about (AD-17, AD-20), assembled from the rows of the resident views as a pure
// function (S04.08): which text a resident reads in their language, what stands in for a translation that failed, who
// is named as the author, and how a thread's own fields (types, audience, valid-until) follow its covering entry.
// Nothing here reads a database or a clock, so every rule below is a unit test (residentThreads.test.ts); the database
// adapter (adapters/resident/readThreads.ts) and the local fixture (adapters/residentFixture.ts) only produce rows.
import { createHash } from "node:crypto";
import type { ArchiveThread, FeedThread } from "../../../contracts/feed";
import type { LangCode } from "../../../contracts/lang";

/** One frozen web text of an entry in one language (`nondrill_alert_entry_translation`). */
export interface ResidentTranslationRow {
  body: string;
  machine: boolean;
  model: string | null;
  /** `translated`, `fallback_en` or `script_converted`: the vocabulary of the table, not of the contract. */
  status: string;
  sourceHash: string;
}

/**
 * One published entry of an open thread (`nondrill_alert_entry` joined to `nondrill_alert`), with its frozen text in the
 * language that was asked for, `null` when it has none (English has none: its text is the entry's own).
 */
export interface ResidentEntryRow {
  threadId: string;
  slug: string;
  entryId: string;
  kind: string;
  phase: string;
  types: readonly string[];
  /** The entry's `Audience`, as stored; the feed's contract checks its shape. */
  audience: unknown;
  validUntil: Date;
  originalText: string;
  publishedAt: Date;
  verified: boolean;
  superseded: boolean;
  /** The entry a correction or a withdrawal replaces (S05.02); null, or left out by a reader that has no such column, for every other entry. */
  supersedesId?: string | null;
  /** S08.02: the building an ambassador's post is attributed to, frozen at submit; null, or left out by a reader that has no such column, for the Hub's own entries. */
  attributedRsn?: string | null;
  translation: ResidentTranslationRow | null;
}

/** The kinds that say something about the disruption itself; a withdrawal notice never does (AD-5, "Substantive entry"). */
const SUBSTANTIVE_KINDS: ReadonlySet<string> = new Set(["ack", "update", "correction", "final"]);

/** The kinds that carry a phase (AD-19): the others are not about how the problem stands. */
const PHASED_KINDS: ReadonlySet<string> = new Set(["ack", "update", "correction"]);

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * The attribution of an entry: role and building, never a person (definitions, "Attribution"). The Hub's own entries are the Hub's; an ambassador's post is
 * attributed to the building frozen with it at submit (S08.02: `alert_entry.attributed_rsn`, read through `nondrill_alert_entry_v3`), so a post is never shown
 * as the Hub's when an ambassador wrote it, whatever their role is now.
 */
export const HUB_ATTRIBUTION = { role: "hub" } as const;

/** The attribution residents read for an entry: the Hub's, or "Building ambassador" of the building frozen with it. */
export function attributionOf(row: Pick<ResidentEntryRow, "attributedRsn">): FeedThread["entries"][number]["attribution"] {
  return row.attributedRsn ? { role: "ambassador", rsn: row.attributedRsn } : { ...HUB_ATTRIBUTION };
}

/**
 * An entry's text for a reader of `lang` (AD-20 `Translated`):
 *  - English reads the entry's own text, `source`.
 *  - A passing translation is `ok` (the table's `translated`) or, for zh-Hant, `script_converted`, as machine text with
 *    its model.
 *  - A language whose translation failed every model is `fallback_en`: `lang` is the language the reader asked for and the
 *    body is the English; the client adds the catalog's "not yet available in this language". A language with no frozen
 *    text at all is the same: nothing is ever shown in a language it was not translated into (AD-10, AD-21).
 */
export function textOf(row: Pick<ResidentEntryRow, "originalText" | "translation">, lang: LangCode): FeedThread["entries"][number]["text"] {
  if (lang === "en") return { lang, body: row.originalText, machine: false, model: null, status: "source", source_hash: sha256(row.originalText) };
  const t = row.translation;
  if (t && (t.status === "translated" || t.status === "script_converted") && t.machine && t.model !== null) {
    return { lang, body: t.body, machine: true, model: t.model, status: t.status === "translated" ? "ok" : "script_converted", source_hash: t.sourceHash };
  }
  // A failed translation (`fallback_en`), a missing one, or a row that does not say what it is: the English, honestly labelled.
  return { lang, body: row.originalText, machine: false, model: null, status: "fallback_en", source_hash: sha256(row.originalText) };
}

function entryOf(row: ResidentEntryRow, lang: LangCode): FeedThread["entries"][number] {
  return {
    id: row.entryId,
    kind: row.kind as FeedThread["entries"][number]["kind"],
    ...(PHASED_KINDS.has(row.kind) ? { phase: row.phase as "problem" | "in_progress" } : {}),
    ...(row.supersedesId ? { supersedes_id: row.supersedesId } : {}),
    verified: row.verified,
    attribution: attributionOf(row),
    published_at: row.publishedAt.toISOString(),
    text: textOf(row, lang),
    original: { lang: "en", body: row.originalText },
  };
}

const byPublication = (a: ResidentEntryRow, b: ResidentEntryRow) => a.publishedAt.getTime() - b.publishedAt.getTime() || (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0);

/**
 * The covering entry of a thread (AD-19): the latest published, non-superseded, substantive one; when there is none (a
 * thread whose only entries were replaced), the latest entry. The thread's types, audience and valid-until are its.
 */
function coveringOf(entries: readonly ResidentEntryRow[]): ResidentEntryRow {
  const live = entries.filter((entry) => !entry.superseded && SUBSTANTIVE_KINDS.has(entry.kind));
  return (live.length > 0 ? live : entries).at(-1)!;
}

/** How a thread closed (the alert's `closed_reason`): the three the resident sees (R-07). */
export type ResidentCloseReason = "resolved" | "expired" | "withdrawn";

const CLOSE_REASONS: readonly string[] = ["resolved", "expired", "withdrawn"];

/**
 * The expire job's final message (S05.04) is the only final residents read that nobody approved: a final is published by its approval or, `published_system`, by the
 * expire job (a final is never D-1: `D1_KINDS`), so here a final that is not verified is that system final. Its words are the Hub's catalog text, written by the Hub's
 * rule; it vouches for nothing new. So it reads with the origin of the entry it closed (UAT F-2): "Verified by the Hub" for an alert the Hub approved, and the
 * attribution and "Not yet verified" of an ambassador's post that ran out before anyone approved it. It never makes an alert read as less checked than it was.
 */
function withSystemFinalOrigin(entries: readonly ResidentEntryRow[]): ResidentEntryRow[] {
  return entries.map((entry, index) => {
    if (entry.kind !== "final" || entry.verified) return entry;
    const closed = entries.slice(0, index).filter((earlier) => !earlier.superseded && SUBSTANTIVE_KINDS.has(earlier.kind) && earlier.kind !== "final").at(-1);
    return closed ? { ...entry, verified: closed.verified, attributedRsn: closed.attributedRsn ?? null } : entry;
  });
}

/** One thread's entries as the feed's thread: its fields follow the covering entry. `closed` says the thread closed and how (S05.03: R-07 reads a closed thread by its address). */
function threadOf(unsorted: readonly ResidentEntryRow[], lang: LangCode, closed?: ResidentCloseReason): { thread: FeedThread; latest: number } {
  const entries = withSystemFinalOrigin([...unsorted].sort(byPublication));
  const covering = coveringOf(entries);
  const thread: FeedThread = {
    id: covering.threadId,
    slug: covering.slug,
    types: [...covering.types],
    audience: covering.audience as FeedThread["audience"],
    state: closed ? "closed" : "open",
    ...(closed ? { close_reason: closed } : {}),
    valid_until: covering.validUntil.toISOString(),
    entries: entries.map((entry) => entryOf(entry, lang)),
  };
  return { thread, latest: entries.at(-1)!.publishedAt.getTime() };
}

/**
 * The feed's threads for one language: every thread that has a published entry, newest activity first, each with its
 * entries in the order they were published (oldest first; a screen that wants newest first turns them around). The rows
 * are of open, non-drill threads only: that is the views' doing, and nothing here could add a drill to them.
 */
export function assembleThreads(rows: readonly ResidentEntryRow[], lang: LangCode): FeedThread[] {
  const byThread = new Map<string, ResidentEntryRow[]>();
  for (const row of rows) {
    const entries = byThread.get(row.threadId);
    if (entries) entries.push(row);
    else byThread.set(row.threadId, [row]);
  }
  const threads = [...byThread.values()].map((unsorted) => threadOf(unsorted, lang));
  return threads.sort((a, b) => b.latest - a.latest || (a.thread.id < b.thread.id ? -1 : 1)).map(({ thread }) => thread);
}

/**
 * One closed thread, for R-07 (S05.03): the entries of a thread that closed, the final message among them, as a `FeedThread` with `state: "closed"` and its
 * `close_reason`. Null when the rows are none, or the reason is not one of the three. It is not in the feed (the feed lists open threads only): a resident reaches it by its
 * address, and the archive (S05.07) lists such threads.
 */
export function assembleClosedThread(rows: readonly ResidentEntryRow[], lang: LangCode, reason: string | null): FeedThread | null {
  if (rows.length === 0 || reason === null || !CLOSE_REASONS.includes(reason)) return null;
  return threadOf(rows, lang, reason as ResidentCloseReason).thread;
}

/** One closed thread of the archive page: how it closed and when (the alert's `closed_reason` and `closed_at`). */
export interface ArchiveHead {
  threadId: string;
  reason: string | null;
  closedAt: Date;
}

/**
 * One page of the archive (S05.07): the closed threads `heads` names, in the order given (newest closed first, which the reader's query decides), each assembled as
 * R-07 shows a closed thread (`assembleClosedThread`: every entry, correction and withdrawal as when live) with `closed_at`. A head with no published entry, or a reason
 * that is not one of the three, is left out: the archive lists only what a resident can read.
 */
export function assembleArchive(rows: readonly ResidentEntryRow[], lang: LangCode, heads: readonly ArchiveHead[]): ArchiveThread[] {
  const byThread = new Map<string, ResidentEntryRow[]>();
  for (const row of rows) {
    const entries = byThread.get(row.threadId);
    if (entries) entries.push(row);
    else byThread.set(row.threadId, [row]);
  }
  return heads.flatMap((head) => {
    const thread = assembleClosedThread(byThread.get(head.threadId) ?? [], lang, head.reason);
    return thread && thread.close_reason ? [{ ...thread, state: "closed" as const, close_reason: thread.close_reason as ArchiveThread["close_reason"], closed_at: head.closedAt.toISOString() }] : [];
  });
}
