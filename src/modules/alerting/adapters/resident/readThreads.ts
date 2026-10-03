// The resident query of the feed (AD-6, AD-17, S04.08): the open threads that have a web-published entry, with each
// entry's frozen text in the language asked for, in ONE statement (so a thread and its entries are one snapshot of the
// database). It reads the resident views and nothing else: `nondrill_alert` for the thread, `nondrill_alert_entry_v2` for
// what is published of it, `nondrill_alert_entry_translation` for the text. A drill's thread is not in them (the first
// view's `where not is_drill`), and an entry that is not web-published is not in the second, so neither can reach a
// resident however this query is changed. The rule against naming another alert relation here is `eslint.config.mjs`'s
// `resident-queries-read-nondrill-only`.
import { and, asc, eq } from "drizzle-orm";
import type { LangCode } from "../../../../contracts/lang";
import type { Db } from "../../../../platform/db";
import { assembleThreads, type ResidentEntryRow } from "../../domain/residentThreads";
import { nondrillAlert, nondrillAlertEntryV2, nondrillAlertEntryTranslation } from "./views";

/** The published entries of the open threads, each with its text in `lang` (none for English: the entry's own text is English). */
export async function readOpenEntries(db: Db, lang: LangCode): Promise<ResidentEntryRow[]> {
  const rows = await db
    .select({
      threadId: nondrillAlert.id,
      slug: nondrillAlertEntryV2.slug,
      entryId: nondrillAlertEntryV2.id,
      kind: nondrillAlertEntryV2.kind,
      phase: nondrillAlertEntryV2.phase,
      types: nondrillAlertEntryV2.types,
      audience: nondrillAlertEntryV2.audience,
      validUntil: nondrillAlertEntryV2.validUntil,
      originalText: nondrillAlertEntryV2.originalText,
      publishedAt: nondrillAlertEntryV2.webPublishedAt,
      verified: nondrillAlertEntryV2.verified,
      superseded: nondrillAlertEntryV2.superseded,
      supersedesId: nondrillAlertEntryV2.supersedesId,
      body: nondrillAlertEntryTranslation.body,
      machine: nondrillAlertEntryTranslation.machine,
      model: nondrillAlertEntryTranslation.model,
      translationStatus: nondrillAlertEntryTranslation.status,
      sourceHash: nondrillAlertEntryTranslation.sourceHash,
    })
    .from(nondrillAlertEntryV2)
    .innerJoin(nondrillAlert, eq(nondrillAlert.id, nondrillAlertEntryV2.alertId))
    .leftJoin(nondrillAlertEntryTranslation, and(eq(nondrillAlertEntryTranslation.entryId, nondrillAlertEntryV2.id), eq(nondrillAlertEntryTranslation.lang, lang)))
    .where(eq(nondrillAlert.status, "open"))
    .orderBy(asc(nondrillAlertEntryV2.webPublishedAt), asc(nondrillAlertEntryV2.id));

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
      translation:
        row.body === null || row.machine === null || row.translationStatus === null || row.sourceHash === null
          ? null
          : { body: row.body, machine: row.machine, model: row.model, status: row.translationStatus, sourceHash: row.sourceHash },
    }),
  );
}

/** The feed's threads for one language, read now. */
export async function readOpenThreads(db: Db, lang: LangCode) {
  return assembleThreads(await readOpenEntries(db, lang), lang);
}
