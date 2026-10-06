// The recipient-count and snapshot port of the approval (S04.07, AD-7, AR-11): how many people an alert's text will reach, per language,
// and the snapshot of who they are, taken inside the approval transaction. Two calls, one rule:
//
//  - `countRecipients(entry, executor)`: the count the approval view shows when it loads, the REVIEWED count. It reads, locks nothing and
//    changes nothing.
//  - `captureRecipients(entry, tx)`: called by the approval use case INSIDE its transaction, after the entry is marked approved, feed_version is raised
//    and E06's marker is set (AD-18's lock order: alert, alert_entry, feed_version, then delivery and the recipient rows). It returns WHO gets a text and in
//    which language, and writes nothing itself: the approval writes the alert deliveries for them through messaging's `enqueueAlertDeliveries(tx, entryId, texts)`,
//    each in the entry's frozen text message for the person's language (the English one where that language has none), and the number of texts that call
//    returns is the count audited and compared with the reviewed one (S04.07's wiring of S06.01). If the two counts differ the approval is refused and the whole
//    transaction, the deliveries included, rolls back.
//
// A DRILL (S06.05, AD-6) goes only to the drill roster: `countRecipients` counts the roster's members per language of the text each gets, and
// `captureRecipients` locks them `FOR SHARE` (a member removed or changed meanwhile waits for the approval to commit) and returns them as `kind: "roster"`,
// with no number read. A drill never reaches a subscriber, and the database refuses it if it tried (the delivery insert guard).
//
// A REAL ENTRY (S07.07, AD-7, AR-11) goes to the receiving subscribers `matches` accepts for the entry's frozen audience, each counted under the language of the
// text they get: their own where the entry has a text message in it (every launch language has one; a language whose translation fell back has the English text
// with `translation.unavailable` in that language), and the English one where it has none (a stored zh-Hant). The query is `recipientStore`, the SQL of `matches`,
// held equal to it by the property test. A correction or a withdrawal adds the recipients of the entry it replaces, and a final those of every other entry of
// its thread (`priorEntryIds`, read by the caller from the thread): the subscribers the outbox queued a text to for those entries, whatever became of the text.
// Topic opt-outs and moves since never remove them, but a subscriber deleted since (STOP, reply 0) is simply not there. People are deduplicated by subscriber,
// and the language is the one each has now.
//
// WHERE `translation.unavailable` IS KEPT: in the frozen text message itself. `render` (messaging) writes it, in the recipient's language, into the body of every
// language whose translation fell back, so the approval sends that body byte for byte and needs no marker of its own; the approver saw how many people it
// concerns, because the count is per language of the body and the view lists the fallback languages with their counts.
//
// See "The approval transaction" in docs/architecture/ARCHITECTURE-SPINE.md.
import type { RecipientCounts } from "../../../contracts/alertApproval";
import type { Audience } from "../../../contracts/audience";
import type { LangCode } from "../../../contracts/lang";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { subscribersQueuedFor } from "../../messaging";
import { drillRosterStore } from "../adapters/drillRosterStore";
import { recipientStore } from "../adapters/recipientStore";
import { bodyLangOf } from "../domain/drillRoster";

/** One language's frozen text message, as submit froze it (alerting's `FrozenSmsBody`, which this module may not import). */
export interface RecipientSmsBody {
  body: string;
  encoding: "gsm7" | "ucs2";
  segments: number;
}

/**
 * The entry whose recipients are wanted: what the audience and the texts are, read by the caller from the entry under its lock. Never
 * taken from a request.
 */
export interface RecipientEntry {
  entryId: string;
  alertId: string;
  /**
   * The entry's kind. A `final` (S05.03) has no target and captures the thread union (epic E05, "Final recipients"): the union, deduplicated by recipient and
   * channel, of the recipients of every entry of `alertId` on the channels each was sent on, plus the final's own audience; opt-outs never remove anyone, and the
   * language is each recipient's current language. It is called after the close has stopped the queued texts of the thread's other entries, so the union is read
   * from those entries' recorded recipients whatever became of their texts.
   */
  kind: string;
  /** A drill goes only to the drill roster (AD-6). */
  isDrill: boolean;
  /** The entry a correction or withdrawal replaces; null for every other entry. */
  supersedesId: string | null;
  /**
   * The entries whose recipients are added to the entry's own (S07.07): for a final, every other entry of its thread, read by the caller under the thread's lock. A
   * correction or a withdrawal needs none (it adds `supersedesId`'s), and a missing list means exactly that. A drill never uses it.
   */
  priorEntryIds?: readonly string[];
  /**
   * S08.06: subscribers whose rows the capture locks `FOR SHARE` in its one id-ordered statement together with the recipients', without making them
   * recipients: the candidate requesters of the check-in round the approval starts, which checkins' `ensureRound` then reads under those locks. All the
   * subscriber rows of one approval are so taken in one id order (AD-18), as the end-of-pilot campaign's `lockActive` takes them: in two passes, a
   * requester whose id is below a recipient's would be locked after it, and the two could deadlock. Never for a drill.
   */
  alsoLock?: readonly string[];
  /** The audience frozen with the entry (AD-7): the one value the matcher takes. */
  audience: Audience;
  types: readonly string[];
  /** The frozen text messages by language, `en` included. */
  smsBodies: Readonly<Record<string, RecipientSmsBody>>;
}

/** The reviewed count, and whether texting is open at all (so the view can say so, and list the web as the only channel when it is not). */
export type RecipientCount = RecipientCounts & { open: boolean };

/**
 * One person the approval texts: `id` is the id of their row in the table `kind` names (never a phone number; lowercase, as the database
 * gives it), and `lang` the language of their own choice, whether or not the entry has a text in it (the approval gives the English text
 * of a language with none, and counts that person under English).
 */
export interface AlertRecipient {
  kind: "subscriber" | "roster";
  id: string;
  lang: LangCode;
}

/** The port the approval is wired to (alerting's `createAlerting` takes it as `recipients`; tests give fakes). */
export interface RecipientsPort {
  count(entry: RecipientEntry, executor: DbExecutor): Promise<RecipientCount>;
  /** Who gets the text, read inside the approval's transaction, locked `FOR SHARE`. Writes nothing: the approval queues the texts. */
  capture(entry: RecipientEntry, tx: DbTransaction): Promise<readonly AlertRecipient[]>;
}

/** The entries whose recipients join the entry's own: the final's thread, or the entry a correction or a withdrawal replaces. */
function priorEntries(entry: RecipientEntry): string[] {
  const ids = new Set<string>(entry.priorEntryIds ?? []);
  if ((entry.kind === "correction" || entry.kind === "withdrawal") && entry.supersedesId !== null) ids.add(entry.supersedesId);
  ids.delete(entry.entryId);
  return [...ids];
}

/**
 * The count the approval view shows. A drill: the roster's members, counted under the language of the text each gets (open: the drill roster is texted
 * whether or not sign-up is open). A real entry: the receiving subscribers its audience matches (and, for a correction, a withdrawal or a final, those the earlier
 * entries were queued to), counted under the language of the text each gets, read through `executor`; locks nothing.
 */
export async function countRecipients(entry: RecipientEntry, executor: DbExecutor): Promise<RecipientCount> {
  const frozenLangs = Object.keys(entry.smsBodies);
  const people: { lang: LangCode }[] = entry.isDrill
    ? await drillRosterStore.members(executor)
    : await recipientStore.reached(executor, entry.audience, await subscribersQueuedFor(executor, priorEntries(entry)));
  const byLanguage: Partial<Record<LangCode, number>> = {};
  for (const person of people) {
    const lang = bodyLangOf(person.lang, frozenLangs);
    byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
  }
  return { open: true, total: people.length, byLanguage };
}

/**
 * The people the approval texts, read inside the approval's transaction `tx` (the same one that marks the entry approved, raises
 * feed_version and audits it: all of it commits, or none). A drill: every member of the drill roster, locked `FOR SHARE`, with their own language
 * (the approval gives the English text where the entry has none in it) and no number. A real entry: the receiving subscribers its audience matches and the
 * earlier entries' recipients still there (see the header), locked `FOR SHARE` in id order, each once, with the language they have now, and the rows of
 * `alsoLock` locked in that same statement (S08.06). Writes nothing.
 */
export async function captureRecipients(entry: RecipientEntry, tx: DbTransaction): Promise<readonly AlertRecipient[]> {
  if (entry.isDrill) {
    const members = await drillRosterStore.membersForShare(tx);
    return members.map((member): AlertRecipient => ({ kind: "roster", id: member.id, lang: member.lang }));
  }
  const reached = await recipientStore.reachedForShare(tx, entry.audience, await subscribersQueuedFor(tx, priorEntries(entry)), entry.alsoLock);
  return reached.map((person): AlertRecipient => ({ kind: "subscriber", id: person.id, lang: person.lang }));
}

/** The port as the module offers it today. */
export const recipientsPort: RecipientsPort = { count: countRecipients, capture: captureRecipients };
