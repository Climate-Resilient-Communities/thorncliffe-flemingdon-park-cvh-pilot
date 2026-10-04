// The recipient-count and snapshot port of the approval (S04.07, AD-7, AR-11): how many people an alert's text will reach, per language,
// and the snapshot of who they are, taken inside the approval transaction. Two calls, one rule:
//
//  - `countRecipients(entry, executor)`: the count the approval view shows when it loads, the REVIEWED count. It reads, locks nothing and
//    changes nothing.
//  - `captureRecipients(entry, tx)`: called by the approval use case INSIDE its transaction, after the entry is marked approved,
//    feed_version is raised and E06's marker is set (AD-18's lock order: alert, alert_entry, feed_version, then delivery and the recipient
//    rows). It returns WHO gets a text and in which language, and writes nothing itself: the approval writes the alert deliveries for them
//    through messaging's `enqueueAlertDeliveries(tx, entryId, texts)`, each in the entry's frozen text message for the person's language
//    (the English one where that language has none), and the number of texts that call returns is the count audited and compared with the
//    reviewed one (S04.07's wiring of S06.01). If the two counts differ the approval is refused and the whole transaction, the deliveries
//    included, rolls back.
//
// A DRILL (S06.05, AD-6) goes only to the drill roster: `countRecipients` counts the roster's members per language of the text each gets, and
// `captureRecipients` locks them `FOR SHARE` (a member removed or changed meanwhile waits for the approval to commit) and returns them as `kind: "roster"`,
// with no number read. A drill never reaches a subscriber, and the database refuses it if it tried (the delivery insert guard).
//
// FOR A REAL ENTRY, UNTIL E07 (the epic that opens text sign-up) there are no subscribers and nothing to send: the port answers that texting is not open,
// with nobody in any language, and `captureRecipients` returns no recipients, so no delivery is written and an approval does what it did
// before the outbox existed. That is the behaviour the story states: the approval view says "Text sign-up is not open yet", shows a count
// of 0, and lists the web as the only channel.
//
// WHERE E07 HOOKS IN. E07's S07.07 replaces the real-entry branch of the two function bodies below (same file, same signatures): `countRecipients` counts
// the matching, receiving subscribers per language of the text each gets, and `captureRecipients` locks them `FOR SHARE` in lock order and
// returns them. Nothing in `alerting` or `messaging` changes for it, and a real entry never returns a roster member.
// See "The approval transaction" in docs/architecture/ARCHITECTURE-SPINE.md.
import { NO_RECIPIENTS, type RecipientCounts } from "../../../contracts/alertApproval";
import type { Audience } from "../../../contracts/audience";
import type { LangCode } from "../../../contracts/lang";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { drillRosterStore } from "../adapters/drillRosterStore";
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
  /** Who gets the text, read inside the approval's transaction (E07: locking them `FOR SHARE`). Writes nothing: the approval queues the texts. */
  capture(entry: RecipientEntry, tx: DbTransaction): Promise<readonly AlertRecipient[]>;
}

/**
 * The count the approval view shows. A drill: the roster's members, counted under the language of the text each gets (open: the drill roster is texted
 * whether or not sign-up is open). A real entry, before E07: texting is not open and nobody will get a text, which reads nothing, so it costs no query.
 * (E07: the count of matching, receiving subscribers per language of the text each gets, read through `executor`.)
 */
export async function countRecipients(entry: RecipientEntry, executor: DbExecutor): Promise<RecipientCount> {
  if (!entry.isDrill) return { open: false, ...NO_RECIPIENTS };
  const frozenLangs = Object.keys(entry.smsBodies);
  const byLanguage: Partial<Record<LangCode, number>> = {};
  const members = await drillRosterStore.members(executor);
  for (const member of members) {
    const lang = bodyLangOf(member.lang, frozenLangs);
    byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
  }
  return { open: true, total: members.length, byLanguage };
}

/**
 * The people the approval texts, read inside the approval's transaction `tx` (the same one that marks the entry approved, raises
 * feed_version and audits it: all of it commits, or none). A drill: every member of the drill roster, locked `FOR SHARE`, with their own language
 * (the approval gives the English text where the entry has none in it) and no number. A real entry, before E07: no one, so it reads nothing.
 * (E07: lock the matching subscribers `FOR SHARE` and return them with their languages.)
 */
export async function captureRecipients(entry: RecipientEntry, tx: DbTransaction): Promise<readonly AlertRecipient[]> {
  if (!entry.isDrill) return [];
  const members = await drillRosterStore.membersForShare(tx);
  return members.map((member): AlertRecipient => ({ kind: "roster", id: member.id, lang: member.lang }));
}

/** The port as the module offers it today. */
export const recipientsPort: RecipientsPort = { count: countRecipients, capture: captureRecipients };
