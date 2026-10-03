// The open threads the feed tells residents about (AD-17, AD-20), assembled from the rows of the resident views as a pure
// function (S04.08): which text a resident reads in their language, what stands in for a translation that failed, who
// is named as the author, and how a thread's own fields (types, audience, valid-until) follow its covering entry.
// Nothing here reads a database or a clock, so every rule below is a unit test (residentThreads.test.ts); the database
// adapter (adapters/resident/readThreads.ts) and the local fixture (adapters/residentFixture.ts) only produce rows.
import { createHash } from "node:crypto";
import type { FeedThread } from "../../../contracts/feed";
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
  translation: ResidentTranslationRow | null;
}

/** The kinds that say something about the disruption itself; a withdrawal notice never does (AD-5, "Substantive entry"). */
const SUBSTANTIVE_KINDS: ReadonlySet<string> = new Set(["ack", "update", "correction", "final"]);

/** The kinds that carry a phase (AD-19): the others are not about how the problem stands. */
const PHASED_KINDS: ReadonlySet<string> = new Set(["ack", "update", "correction"]);

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * The attribution of an entry: role and building, never a person (definitions, "Attribution"). Every entry that exists in
 * this epic is the Hub's: `beginSubmit` refuses an Ambassador author until E08. SEAM for E08: S08.02 persists the
 * attribution with the freeze (spine, AD-5 "Seam for E08"), and the view above then carries it, so that a post is never
 * shown as the Hub's when an ambassador wrote it.
 */
export const HUB_ATTRIBUTION = { role: "hub" } as const;

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
    verified: row.verified,
    attribution: { ...HUB_ATTRIBUTION },
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
  const threads = [...byThread.values()].map((unsorted) => {
    const entries = [...unsorted].sort(byPublication);
    const covering = coveringOf(entries);
    const thread: FeedThread = {
      id: covering.threadId,
      slug: covering.slug,
      types: [...covering.types],
      audience: covering.audience as FeedThread["audience"],
      state: "open",
      valid_until: covering.validUntil.toISOString(),
      entries: entries.map((entry) => entryOf(entry, lang)),
    };
    return { thread, latest: entries.at(-1)!.publishedAt.getTime() };
  });
  return threads.sort((a, b) => b.latest - a.latest || (a.thread.id < b.thread.id ? -1 : 1)).map(({ thread }) => thread);
}
