// The recipient-count and snapshot port of the approval (S04.07, AD-7, AR-11): how many people an alert's text will reach, per language,
// and the snapshot of who they are, taken inside the approval transaction. Two calls, one rule:
//
//  - `countRecipients(entry, executor)`: the count the approval view shows when it loads, the REVIEWED count. It reads, locks nothing and
//    changes nothing.
//  - `captureRecipients(entry, tx)`: called by the approval use case INSIDE its transaction, after the entry is marked approved and
//    feed_version is raised (AD-18's lock order: alert, alert_entry, feed_version, then delivery and the recipient rows), and before the
//    count is compared with the reviewed one. It returns the snapshot's count; if that differs from the reviewed count the approval is
//    refused and the whole transaction, this capture included, rolls back (S04.07).
//
// UNTIL E07 (the epic that opens text sign-up) there are no subscribers and nothing to send: the port answers that texting is not open,
// with nobody in any language, and writes nothing. That is the behaviour the story states: the approval view says "Text sign-up is not
// open yet", shows a count of 0, and lists the web as the only channel.
//
// WHERE E06 AND E07 HOOK IN. E07's S07.07 replaces the two function bodies below (same file, same signatures); nothing in `alerting`
// changes for it. `captureRecipients` then: locks the matching subscriber rows `FOR SHARE` in lock order, and writes one alert delivery
// per subscriber (a drill entry: its drill roster, S06.05) through messaging's `enqueueAlertDeliveries(tx, entryId, texts)`, each in
// the entry's frozen `smsBodies[lang]` (a language with no frozen body gets `en`), and returns the number of texts written, grouped by
// the language of the body. E06's S06.01 asks the approval for one thing first: `markApprovalTransaction(tx, entryId)` must run before
// `captureRecipients` writes anything; the approval use case calls it through its `markApproval` dependency, which `createAlerting` (in
// src/modules/alerting/index.ts) is given in one line when E06 is merged. See "The approval transaction" in docs/architecture/ARCHITECTURE-SPINE.md.
import { NO_RECIPIENTS, type RecipientCounts } from "../../../contracts/alertApproval";
import type { Audience } from "../../../contracts/audience";
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

/** The port the approval is wired to (alerting's `createAlerting` takes it as `recipients`; tests give fakes). */
export interface RecipientsPort {
  count(entry: RecipientEntry, executor: DbExecutor): Promise<RecipientCount>;
  capture(entry: RecipientEntry, tx: DbTransaction): Promise<RecipientCounts>;
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
 * The recipient snapshot, taken inside the approval's transaction `tx` (the same one that marks the entry approved, raises feed_version
 * and audits it: all of it commits, or none). Before E07 there is no one to capture, so it writes nothing and returns an empty snapshot.
 * (E07: lock the matching subscribers `FOR SHARE`, create their alert deliveries through messaging, return the count written.)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the port's signature: E07 reads the entry and writes its deliveries through the transaction
export async function captureRecipients(_entry: RecipientEntry, _tx: DbTransaction): Promise<RecipientCounts> {
  return NO_RECIPIENTS;
}

/** The port as the module offers it today. */
export const recipientsPort: RecipientsPort = { count: countRecipients, capture: captureRecipients };
