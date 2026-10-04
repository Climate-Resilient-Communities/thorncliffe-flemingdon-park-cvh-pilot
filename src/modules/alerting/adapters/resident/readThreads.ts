// The resident query of the feed (AD-6, AD-17, S04.08): the open threads that have a web-published entry, with each
// entry's frozen text in the language asked for, in ONE statement (so a thread and its entries are one snapshot of the
// database). It reads the resident views and nothing else: `nondrill_alert` for the thread, `nondrill_alert_entry_v3` for
// what is published of it, `nondrill_alert_entry_translation` for the text. A drill's thread is not in them (the first
// view's `where not is_drill`), and an entry that is not web-published is not in the second, so neither can reach a
// resident however this query is changed. The rule against naming another alert relation here is `eslint.config.mjs`'s
// `resident-queries-read-nondrill-only`.
import { and, asc, eq, gt, or, type SQL } from "drizzle-orm";
import type { LangCode } from "../../../../contracts/lang";
import type { Db } from "../../../../platform/db";
import { AudienceSchema } from "../../../../contracts/audience";
import type { EntryKind } from "../../domain/lifecycle";
import { assembleClosedThread, assembleThreads, type ResidentEntryRow } from "../../domain/residentThreads";
import { RESOLVED_WINDOW_MS, type StatusEntry, type StatusThread } from "../../domain/status";
import { nondrillAlert, nondrillAlertEntryV3, nondrillAlertEntryTranslation } from "./views";

/** The published entries of the threads `where` picks, each with its text in `lang` (none for English: the entry's own text is English), oldest first. */
async function readEntries(db: Db, lang: LangCode, where: SQL | undefined): Promise<ResidentEntryRow[]> {
  const rows = await db
    .select({
      threadId: nondrillAlert.id,
      slug: nondrillAlertEntryV3.slug,
      entryId: nondrillAlertEntryV3.id,
      kind: nondrillAlertEntryV3.kind,
      phase: nondrillAlertEntryV3.phase,
      types: nondrillAlertEntryV3.types,
      audience: nondrillAlertEntryV3.audience,
      validUntil: nondrillAlertEntryV3.validUntil,
      originalText: nondrillAlertEntryV3.originalText,
      publishedAt: nondrillAlertEntryV3.webPublishedAt,
      verified: nondrillAlertEntryV3.verified,
      superseded: nondrillAlertEntryV3.superseded,
      supersedesId: nondrillAlertEntryV3.supersedesId,
      attributedRsn: nondrillAlertEntryV3.attributedRsn,
      body: nondrillAlertEntryTranslation.body,
      machine: nondrillAlertEntryTranslation.machine,
      model: nondrillAlertEntryTranslation.model,
      translationStatus: nondrillAlertEntryTranslation.status,
      sourceHash: nondrillAlertEntryTranslation.sourceHash,
    })
    .from(nondrillAlertEntryV3)
    .innerJoin(nondrillAlert, eq(nondrillAlert.id, nondrillAlertEntryV3.alertId))
    .leftJoin(nondrillAlertEntryTranslation, and(eq(nondrillAlertEntryTranslation.entryId, nondrillAlertEntryV3.id), eq(nondrillAlertEntryTranslation.lang, lang)))
    .where(where)
    .orderBy(asc(nondrillAlertEntryV3.webPublishedAt), asc(nondrillAlertEntryV3.id));

  return rows.map(
    (row): ResidentEntryRow => ({
      threadId: row.threadId,
      slug: row.slug,
      entryId: row.entryId,
      kind: row.kind,
      phase: row.phase,
      types: row.types,
      audience: row.audience,
      validUntil: row.validUntil,
      originalText: row.originalText,
      publishedAt: row.publishedAt,
      verified: row.verified,
      superseded: row.superseded,
      supersedesId: row.supersedesId,
      attributedRsn: row.attributedRsn,
      translation:
        row.body === null || row.machine === null || row.translationStatus === null || row.sourceHash === null
          ? null
          : { body: row.body, machine: row.machine, model: row.model, status: row.translationStatus, sourceHash: row.sourceHash },
    }),
  );
}

/** The published entries of the open threads, each with its text in `lang` (none for English: the entry's own text is English). */
export const readOpenEntries = (db: Db, lang: LangCode): Promise<ResidentEntryRow[]> => readEntries(db, lang, eq(nondrillAlert.status, "open"));

/** The feed's threads for one language, read now. */
export async function readOpenThreads(db: Db, lang: LangCode) {
  return assembleThreads(await readOpenEntries(db, lang), lang);
}

/** The slugs of the closed threads residents can read (one cheap statement): the gate in front of `readClosedThread`, so an address that is no closed thread's costs no further read. */
export async function readClosedSlugs(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ slug: nondrillAlertEntryV3.slug })
    .from(nondrillAlertEntryV3)
    .innerJoin(nondrillAlert, eq(nondrillAlert.id, nondrillAlertEntryV3.alertId))
    .where(eq(nondrillAlert.status, "closed"));
  return rows.map((row) => row.slug);
}

/**
 * The closed thread with this slug for one language, read now (S05.03): R-07 shows a thread that closed, with its close reason, the final message and every earlier
 * entry. It is read from the same resident views as the feed (a drill's thread is not in them; an entry that is not web-published is not), and never is in the feed.
 * Null when no closed thread has this address.
 */
export async function readClosedThread(db: Db, lang: LangCode, slug: string) {
  const rows = await readEntries(db, lang, and(eq(nondrillAlert.status, "closed"), eq(nondrillAlertEntryV3.slug, slug)));
  if (rows.length === 0) return null;
  const [thread] = await db.select({ reason: nondrillAlert.closedReason }).from(nondrillAlert).where(eq(nondrillAlert.id, rows[0].threadId));
  return assembleClosedThread(rows, lang, thread?.reason ?? null);
}

/**
 * The status threads (S05.06, AD-19): the non-drill threads that are open, and those closed `resolved` in the 12 hours before `now`, with every published entry (no
 * text: status needs the kind, phase, verification, audience and whether it was replaced). Read from the same resident views as the feed, so a drill never appears;
 * the closed ones are not in the feed's thread list, which is why this is its own statement. An entry whose audience does not parse is kept with a null audience: it covers nothing but still counts when the covering entry is chosen.
 */
export async function readStatusThreads(db: Db, now: Date): Promise<StatusThread[]> {
  const since = new Date(now.getTime() - RESOLVED_WINDOW_MS);
  const rows = await db
    .select({
      threadId: nondrillAlert.id,
      status: nondrillAlert.status,
      closedReason: nondrillAlert.closedReason,
      closedAt: nondrillAlert.closedAt,
      slug: nondrillAlertEntryV3.slug,
      entryId: nondrillAlertEntryV3.id,
      kind: nondrillAlertEntryV3.kind,
      phase: nondrillAlertEntryV3.phase,
      audience: nondrillAlertEntryV3.audience,
      verified: nondrillAlertEntryV3.verified,
      superseded: nondrillAlertEntryV3.superseded,
      publishedAt: nondrillAlertEntryV3.webPublishedAt,
    })
    .from(nondrillAlertEntryV3)
    .innerJoin(nondrillAlert, eq(nondrillAlert.id, nondrillAlertEntryV3.alertId))
    .where(or(eq(nondrillAlert.status, "open"), and(eq(nondrillAlert.status, "closed"), eq(nondrillAlert.closedReason, "resolved"), gt(nondrillAlert.closedAt, since))))
    .orderBy(asc(nondrillAlertEntryV3.webPublishedAt), asc(nondrillAlertEntryV3.id));
  const threads = new Map<string, StatusThread & { entries: StatusEntry[] }>();
  for (const row of rows) {
    const audience = AudienceSchema.safeParse(row.audience);
    let thread = threads.get(row.threadId);
    if (!thread) {
      thread = { id: row.threadId, slug: row.slug, state: row.status === "open" ? "open" : "closed", closeReason: row.closedReason, closedAt: row.closedAt, entries: [] };
      threads.set(row.threadId, thread);
    }
    thread.entries.push({
      id: row.entryId,
      kind: row.kind as EntryKind,
      phase: row.phase,
      verified: row.verified,
      superseded: row.superseded,
      publishedAt: row.publishedAt,
      audience: audience.success ? audience.data : null,
    });
  }
  return [...threads.values()];
}
