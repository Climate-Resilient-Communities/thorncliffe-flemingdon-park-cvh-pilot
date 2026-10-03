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
// UNTIL E07 (the epic that opens text sign-up) there are no subscribers and nothing to send: the port answers that texting is not open,
// with nobody in any language, and `captureRecipients` returns no recipients, so no delivery is written and an approval does what it did
// before the outbox existed. That is the behaviour the story states: the approval view says "Text sign-up is not open yet", shows a count
// of 0, and lists the web as the only channel.
//
// WHERE E07 AND S06.05 HOOK IN. E07's S07.07 replaces the two function bodies below (same file, same signatures): `countRecipients` counts
// the matching, receiving subscribers per language of the text each gets, and `captureRecipients` locks them `FOR SHARE` in lock order and
// returns them (a drill entry: its drill roster members, `kind: "roster"`, S06.05). Nothing in `alerting` or `messaging` changes for it.
// See "The approval transaction" in docs/architecture/ARCHITECTURE-SPINE.md.
import { NO_RECIPIENTS, type RecipientCounts } from "../../../contracts/alertApproval";
import type { Audience } from "../../../contracts/audience";
import type { LangCode } from "../../../contracts/lang";
import type { DbExecutor, DbTransaction } from "../../../platform/db";

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
 * The count the approval view shows: before E07, texting is not open and nobody will get a text. Reads nothing, so it costs no query.
 * (E07: the count of matching, receiving subscribers per language of the text each gets, read through `executor`.)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the port's signature: E07 reads the entry and runs its query through the executor
export async function countRecipients(_entry: RecipientEntry, _executor: DbExecutor): Promise<RecipientCount> {
  return { open: false, ...NO_RECIPIENTS };
}

/**
 * The people the approval texts, read inside the approval's transaction `tx` (the same one that marks the entry approved, raises
 * feed_version and audits it: all of it commits, or none). Before E07 there is no one, so it reads nothing and returns no recipients.
 * (E07: lock the matching subscribers `FOR SHARE` and return them with their languages; a drill entry returns its drill roster.)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the port's signature: E07 reads the entry and its subscribers through the transaction
export async function captureRecipients(_entry: RecipientEntry, _tx: DbTransaction): Promise<readonly AlertRecipient[]> {
  return [];
}

/** The port as the module offers it today. */
export const recipientsPort: RecipientsPort = { count: countRecipients, capture: captureRecipients };
