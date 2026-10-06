// The thread and entry use cases of S04.03 (AD-5, AD-18): create a thread with its first draft, save a
// draft, submit, return, discard, approve and "Try translation again". Every one runs in one
// transaction that starts with `SELECT ... FROM alert WHERE id = $1 FOR UPDATE`, then locks the entry,
// then (approval only) feed_version: the order alert -> alert_entry -> feed_version. It re-reads the
// thread, refuses with ALERT_CLOSED when it is closed, judges every fact from rows read under the
// lock (the entry, its status, the author's and the actor's current standing), never from the request,
// and sets the session variable `cvh.actor_id` that the entry trigger requires. The role policy
// (S01.12) is asked inside the transaction; the database triggers repeat the rules the data itself
// must keep, so a use case that forgot one is still refused.
//
// A refusal rolls the transaction back and is audited as refused in its own transaction (S01.04).
import { randomBytes } from "node:crypto";
import { and, arrayOverlaps, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { closeRound } from "../../checkins";
import { decidePolicy, meetsAssurance } from "../../identity";
import { recipientsPort, type RecipientCount, type RecipientEntry, type RecipientSmsBody, type RecipientsPort } from "../../subscriptions";
import { alertTextsOf, countsOfTexts, type AlertText } from "./approvalTexts";
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import { addTorontoDays } from "../../../platform/clock";
import { uuidv7 } from "../../../platform/ids";
import { alert, alertEntry, alertEntryTranslation, alertSubmitAttempt, feedVersion } from "../adapters/schema";
import { NO_RECIPIENTS, RETURN_NOTE_MAX, sameRecipientCounts, type RecipientCounts } from "../../../contracts/alertApproval";
import { audienceCoversBuilding, audienceRsns, type Audience } from "../../../contracts/audience";
import type { StaffRole } from "../../../contracts/staffRoles";
import { UNTIL_RESOLVED_MS, VALID_UNTIL_MAX_DAYS, audienceBuildings, contentRefusal, draftFingerprint, isWideContent, sameContent, validUntilRefusal, type EntryContent, type Phase, type ValidUntilMode } from "../domain/content";
import { isD1Eligible } from "../domain/d1";
import { possibleDuplicateOf } from "../domain/duplicates";
import { AUTHORED_KINDS, checkApproval, checkShownBinding, requestTransition, type EntryKind, type EntryStatus, type ReturnReason } from "../domain/lifecycle";
import type { AlertRefusal } from "../domain/refusals";
import { ENTRY_CHANNELS, SUBMIT_KEY_PATTERN, isStaleAttempt, type AttemptKind, type AttemptState } from "../domain/submitAttempt";
import { FROZEN_LANGS } from "../domain/translations";
import { coveringEntry, isPublished, updateStart } from "../domain/thread";
import { isSupersedingKind, isWithdrawalReason, substantiveRemains, targetRefusal, type TargetFacts, type WithdrawalReason } from "../domain/corrections";
import { createCloseAlert } from "./closeAlert";
import { attributionFor, attributionOfRsn, discardReasonOf, rsnOfAttribution, sameAttribution, type DiscardReason, type EntryAttribution } from "../domain/ambassadorPost";
import { Refused } from "./refused";
import { placeRefusal, resolveGroups, resolvePlace, type AudiencePlaces, type BuildingChoice, type PlaceChoice } from "./audience";
import type { AlertActor, AlertAudit, AlertResult, FrozenContent, FrozenSmsBody, PrepareContext, StaffDirectory } from "./ports";
import { publishedSummaries, readClosedThreads, readRunningThreads, readThreadSummary, type ClosedThread, type RunningThread, type ThreadSummary } from "./threads";
import { AUDIT_REASON, INVALID_FORM_AUDIT_ACTION, INVALID_FORM_CODE, INVALID_FORM_REASON, type InvalidFormAction } from "./refusalReasons";
import type { StaffStanding } from "../../identity";

export interface AlertLifecycleDeps {
  db: Db;
  audit: AlertAudit;
  staff: StaffDirectory;
  /** The places an audience may name (S04.04): read in the use case's own transaction. */
  places: AudiencePlaces;
  now?: () => Date;
  newId?: () => string;
  /** The short public slug of a new thread (S04.05). Defaults to eight random letters and numbers. */
  newSlug?: () => string;
  /** The latest valid-until allowed now: 7 Toronto calendar days ahead (platform/clock#addTorontoDays). A seam for tests. */
  latestValidUntil?: (now: Date) => Date;
  /**
   * Who the text reaches (S04.07): the count the approval view shows (`count`) and the people the approval captures inside its transaction
   * (`capture`, which is `captureRecipients(entry, tx)`: who gets a text and in which language; it writes nothing). Subscriptions' port, empty until E07.
   */
  recipients?: RecipientsPort;
  /**
   * The outbox's approval marker (S06.01): called in the approval's transaction after the entry is approved and `feed_version` is raised, with the
   * entry being approved, and before `captureRecipients` is asked for anyone or anything is written. `createAlerting` wires messaging's
   * `createDeliveryQueue().markApprovalTransaction` here; the default does nothing (the use case's own tests, which write no delivery).
   */
  markApproval?: (tx: DbTransaction, entryId: string) => Promise<void>;
  /**
   * The outbox's writer of alert texts (S06.01), called once in the approval's transaction after the marker, with the texts for the people
   * captured and only when there are some. `createAlerting` wires messaging's `createDeliveryQueue().enqueueAlertDeliveries` here and gives
   * back every text the outbox holds for the entry, the number of which is the count the approval audits and compares with the reviewed one.
   * Without one, an approval that captured anyone fails and changes nothing.
   */
  queueAlertTexts?: (tx: DbTransaction, entryId: string, texts: readonly AlertText[]) => Promise<readonly { lang: string }[]>;
  /** Cents CAD per text message segment (SMS_PRICE_PER_SEGMENT_CENTS), for each queued text's cost estimate; read only when someone is to be texted. */
  pricePerSegmentCents?: () => number;
  /**
   * The monthly spending cap's check (S07.08), called in the approval's transaction after the entry's texts are queued, only when someone is to be
   * texted: with the entry's own estimate in cents it answers how far the month's spending would pass the cap, or null when it does not (or no cap is
   * set). When it passes, the implementation also records the `spend.cap_overrun` ops event in this transaction; the use case audits it. It warns and
   * never refuses. `createAlerting` wires spend's `assessApproval` and messaging's `queuedCostCents` here; left out (the use case's own tests), no cap.
   */
  spendCap?: (tx: DbTransaction, input: { entryId: string; entryCostCents: number; now: Date }) => Promise<{ overCents: number; capCents: number } | null>;
  /**
   * messaging's `cancelQueued(entryIds, tx)` (S05.02): called in the transaction of every use case that supersedes an entry or closes a thread, so the texts of
   * those entries that are not yet handed to the provider stop exactly when the change commits. `createAlerting` wires `createDeliveryQueue().cancelQueued`
   * here; the default does nothing (the use case's own tests, which write no delivery).
   */
  cancelQueued?: (tx: DbTransaction, entryIds: readonly string[]) => Promise<void>;
  /**
   * The on-call rule of the approval (S06.07): while `required()` is true (texting is live, decided by the composition root), a non-drill alert is
   * approved only if `hasNumber(tx)` finds at least one number on ops' on-call roster, read in the approval's transaction; otherwise it is refused
   * with ONCALL_REQUIRED and nothing changes. Left out (the use case's own tests), the rule is off.
   */
  oncall?: { required: () => boolean; hasNumber: (tx: DbTransaction) => Promise<boolean> };
  /**
   * The check-in round an approval starts or adds to (S08.06, AD-12, E08 "Round"), in the approval's transaction of an acknowledgement, an update or a
   * correction in a thread that is not a drill (and open: the approval refuses a closed one), with the thread as the approved entry has it (its id, types
   * and audience). Two steps, wired by `createAlerting`:
   *  - `requesters`, before the texts are captured: the candidates, read without a lock (none unless one of the entry's types is a round type, read in this
   *    transaction, so an Admin's change applies from the next approval). The capture locks their rows FOR SHARE in its one id-ordered statement with the
   *    recipients' (`alsoLock`): every subscriber row of the approval in one id order (AD-18).
   *  - `start`, after the texts are queued and the approval audited, with those candidates: checkins' `ensureRound`, which reads each one's request under that
   *    lock and adds one row for each whose "where I live" place matches the audience on a covered floor and who has none in the thread (AD-18: the
   *    recipient rows, then `checkin`, then `checkin_tally`, before the spend cap). Answers how many rows it added.
   * Left out (the use case's own tests), an approval starts no round.
   */
  rounds?: {
    requesters: (tx: DbTransaction, thread: RoundStart) => Promise<string[]>;
    start: (tx: DbTransaction, thread: RoundStart, requesterIds: readonly string[]) => Promise<number>;
  };
  /**
   * The catalog's words of the system withdrawal that takes the place of a web-published post when it is discarded (S08.03), in English: residents read them with
   * "Withdrawn". `createAlerting` callers pass the catalog's (`staff.discard.withdrawnText`); the default is for the use case's own tests.
   */
  discardWithdrawalText?: () => string;
}

/** The entry as the Hub's screens and the next stories read it. */
export interface EntryView {
  id: string;
  alertId: string;
  kind: EntryKind;
  status: EntryStatus;
  authorId: string;
  editorIds: readonly string[];
  content: EntryContent;
  version: number;
  contentHash: string | null;
  submittedAt: Date | null;
  returnedFor: ReturnReason | null;
  /** The note an approver wrote when they sent the entry back to its author: present exactly while `returnedFor` is `return` (S04.07). */
  returnedNote: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  webPublishedAt: Date | null;
  /** The open, non-drill thread this entry may duplicate, worked out at submit (S04.05); the approver is shown a link to it. */
  possibleDuplicateOf: string | null;
  /** The entry a correction or a withdrawal replaces (S05.02); null, or absent in a view built before it existed, for every other entry. */
  supersedesId?: string | null;
  /** Why a withdrawal was made, from the catalog (S05.02); null or absent for every other entry. */
  withdrawalReason?: WithdrawalReason | null;
  /** Why it was discarded (S08.02): its author took it back, the Hub declined it, or its thread closed first; null for an entry that is not discarded (or was discarded before the reason was kept). */
  discardReason?: DiscardReason | null;
  /** The building an ambassador's post is attributed to, frozen at submit with its texts (S08.02); null for the Hub's entries and for a draft. */
  attributedRsn?: string | null;
}

export interface ThreadView {
  id: string;
  /** The short public slug: the texts link to `/a/{slug}`. */
  slug: string;
  isDrill: boolean;
  reportedAt: Date;
  status: "open" | "closed";
}

export interface NewAlertInput {
  kind: (typeof AUTHORED_KINDS)[number];
  isDrill: boolean;
  /** When the first report reached the Hub; never later than now. */
  reportedAt: Date;
  content: EntryContent;
}

/** What the request names. Everything else is read from the database under the lock. */
export interface EntryRef {
  alertId: string;
  entryId: string;
}

/** The version and hash the approver was shown (the approval binding). */
export interface ApprovalBinding {
  version: number;
  contentHash: string;
}

/**
 * What an approver presses Approve on (S04.07): the version and hash they were shown, and the number of people the text reaches, as the
 * view counted them when it loaded (the reviewed count). The approval is refused if the entry changed, and if the snapshot taken inside
 * the approval's transaction counts anyone else.
 */
export interface ApprovalRequest extends ApprovalBinding {
  /** Left out, the approver reviewed nobody (the count before E07 opens text sign-up): a snapshot that counts anyone is then refused. */
  recipients?: RecipientCounts;
  /**
   * The entry that covered the thread when the approver read an update's "Now also for" line (S05.01). If another entry covers it by the time of the
   * approval, the line no longer describes the thread and nothing is approved (ENTRY_CHANGED). Left out for an entry that was shown none.
   */
  covering?: string;
}

/** What an approval did, once it committed: the entry as approved, the recipient snapshot it captured, and the feed version it raised (null for a drill, which changes nothing the web shows). */
export interface ApprovalOutcome {
  entry: EntryView;
  recipients: RecipientCounts;
  feedVersion: number | null;
}

/** What a Return or a Discard may name besides the entry: the version and hash the person was shown, so an entry that changed since is refused (ENTRY_CHANGED). */
export interface ReviewAction {
  shown?: ApprovalBinding;
}

/** One web text of the entry as frozen: how the language's text came to be, and the text. */
export interface ReviewedText {
  lang: string;
  body: string;
  status: string;
  machine: boolean;
  model: string | null;
}

/**
 * Everything the approval view shows, read in one snapshot (S04.07): the entry as stored, its frozen web texts and text messages, the author's
 * role now (O-07 is an ambassador's post), the possible duplicate, and the number of people the text reaches as it stands now: the reviewed count.
 */
export interface EntryReview {
  thread: ThreadView;
  entry: EntryView;
  authorRole: StaffRole | null;
  /**
   * Who the entry is from, as frozen at submit with its texts (S08.02): an ambassador's post is the building's, whatever the author's role is now. Null for an
   * entry that holds no frozen texts (a draft): the view then goes by `authorRole`.
   */
  attribution: EntryAttribution | null;
  texts: readonly ReviewedText[];
  sms: Readonly<Record<string, FrozenSmsBody>>;
  recipients: RecipientCount;
  /** The other open thread this entry may duplicate, and its newest pending or approved entry to link to (null when it holds none). */
  duplicate: { alertId: string; entryId: string | null } | null;
  /**
   * The audience the thread has now: that of the entry that covers it, which is what residents are told today (S05.01). Set for a draft or a pending
   * entry that follows another in its thread (an update), so the approver is shown what the entry changes ("Now also for: ..."); null for a thread's
   * first entry and for an entry that is not waiting.
   */
  threadAudience: Audience | null;
  /** The id of the entry that covers the thread now, whose audience `threadAudience` is: what the "Now also for" line was read against; null with it. */
  threadCoveringId: string | null;
  /**
   * The entry a correction or a withdrawal replaces, as residents read it now (S05.02): what the approver compares the correction with, and what the approval
   * will replace. Null for every other entry. `valid` is whether it is still a valid target (a target already replaced since the entry was submitted is shown
   * as such, and the approval will refuse it).
   */
  target?: { id: string; kind: EntryKind; status: EntryStatus; text: string; phase: Phase; publishedAt: Date | null; valid: boolean; audience: Audience } | null;
  /**
   * An entry that closes the thread once approved: a withdrawal that leaves no published, non-superseded substantive entry (it closes `withdrawn`, S05.02),
   * and a final (it closes `resolved`, S05.03). False for everything else.
   */
  closesThread?: boolean;
}

/** One entry on someone's incidents list (S04.07's share of O-01, which S04.10 builds out). */
export interface IncidentRow {
  alertId: string;
  entryId: string;
  kind: EntryKind;
  status: "draft" | "pending_approval";
  types: readonly string[];
  isDrill: boolean;
  version: number;
  /** When it was submitted (a pending entry), or null for a draft. */
  submittedAt: Date | null;
  /** The note an approver wrote when they sent it back to its author: shown to the author until they submit again. */
  returnedNote: string | null;
  /**
   * The entry follows another in its thread (an update added to a running thread, S05.01): it is written on the update composer. Absent is false: the
   * thread's first entry, written on the acknowledgement or alert composer.
   */
  followUp?: boolean;
}

/** What waits for a person, and what they have in hand. */
export interface Incidents {
  /** Pending entries in open threads that this person may approve (a Coordinator or an Admin who is not an editor), longest waiting first. */
  waiting: readonly IncidentRow[];
  /** The open drafts and pending entries this person is an editor of, newest first. */
  mine: readonly IncidentRow[];
}

/**
 * "Log a disruption" (O-11, S04.05): what the person chose, before any text exists. The place is the picker's choice; the
 * audience is made from it inside the use case's transaction (as chooseAudiencePlace does), and `textFor` builds the first
 * text, the suggested acknowledgement, from the audience as it was made. The author edits that text next.
 */
export interface LogDisruptionInput {
  kind: (typeof AUTHORED_KINDS)[number];
  isDrill: boolean;
  /** When the first report reached the Hub; never later than now. */
  reportedAt: Date;
  types: readonly string[];
  place: PlaceChoice;
  /** `problem` unless the first entry says work is under way. */
  phase?: Phase;
  /** The valid-until the draft starts with; "until resolved" (24 elapsed hours from now) when not given. */
  validUntil?: Date;
  textFor: (audience: Audience) => string;
}

/** One press of Submit, as the browser and the Hub's screens read it (S04.05). */
export interface AttemptView {
  key: string;
  kind: AttemptKind;
  /** A `running` attempt older than the submit function's time limit reads as `failed` (SUBMIT_ABANDONED): its function is gone. */
  state: AttemptState;
  outcome: AlertRefusal | null;
  startedAt: Date;
  finishedAt: Date | null;
  budgetMs: number | null;
  /** Each language's result as it settled while the attempt ran: `translated`, `script_converted` or `fallback_en`. */
  progress: Readonly<Record<string, string>>;
  resultVersion: number | null;
  resultHash: string | null;
}

/** The entry's authoritative state for a browser that returns to it: what is stored now, and the latest attempt. */
export interface EntryState {
  thread: ThreadView;
  entry: EntryView;
  attempt: AttemptView | null;
  /** The frozen translations (a pending or approved entry): each language and how its text came to be. */
  translations: readonly { lang: string; status: string; machine: boolean }[];
  /**
   * The kinds of the entries made before this one in its thread, oldest first (S05.01). Absent or empty: this is the thread's first entry (written on the
   * acknowledgement or alert composer); otherwise it follows them (an update, written on the update composer, which is "Promote to full alert" while
   * every earlier entry is an acknowledgement).
   */
  priorKinds?: readonly EntryKind[];
}

/**
 * What an update starts from and is made of (S05.01): the English text, where things stand (required: the author chooses it, it is never carried over), and
 * the valid-until the author chose ("until resolved", renewed to 24 hours from now, or a time). The types and the audience are not here: they are the
 * thread's, carried over from the entry that covers it, and an update changes the audience only through the pickers afterwards.
 */
export interface AddUpdateInput {
  /**
   * The id the new entry takes. The page makes it when it draws the form, so that pressing the button twice, or a browser that sends the request again,
   * makes one entry: a request whose id is already this person's update in this thread returns that update and changes nothing.
   */
  entryId: string;
  text: string;
  phase: Phase;
  validUntil: Date;
  validUntilMode: ValidUntilMode;
}

/**
 * An ambassador's post (S08.02, A-02): what they chose on the one screen. The page makes the ids when it draws the form, so that a press sent again (twice,
 * or by a page that held it until signal came back) makes one thread and one entry.
 */
export interface AmbassadorPostInput {
  /** The open thread the post is an update to (a practice post in a drill, or an update about an alert), or null for a new thread: its first entry. */
  into: string | null;
  /** The id the new thread takes when `into` is null (made by the page); ignored otherwise. */
  alertId: string;
  /** The id the new entry takes (made by the page). */
  entryId: string;
  /** The one building the post is for, and its floors: the whole building, a list, or a range from one floor to another by the building's order. */
  place: BuildingChoice;
  /** What is happening: the types an Ambassador may post (power, water, elevator, fire, flood, other). An update to a thread keeps the thread's, whatever is sent. */
  types: readonly string[];
  phase: Phase;
  validUntil: Date;
  validUntilMode: ValidUntilMode;
  /** The English text, as the post's author wrote it. */
  text: string;
}

/**
 * What a correction is made of (S05.02): the corrected English wording, where things stand (required, as for an update), and the valid-until the author chose.
 * The types and the audience are not here: they start as the thread's, from the entry that covers it, and change only through the pickers afterwards.
 */
export interface CorrectInput {
  /** The id the new entry takes, made by the page (as for an update): a request whose id is already this person's correction of this target returns it. */
  entryId: string;
  text: string;
  phase: Phase;
  validUntil: Date;
  validUntilMode: ValidUntilMode;
}

/**
 * What a withdrawal is made of (S05.02): the reason chosen from the catalog, and the notice residents read in the target's place (the words the Hub wrote for
 * "other", else the catalog's words for the reason, which the caller puts here: `domain/corrections.ts#withdrawalText`). Everything else is the target's.
 */
export interface WithdrawInput {
  entryId: string;
  reason: string;
  text: string;
}

/**
 * What a final is made of (S05.03, "Mark resolved" O-16): the English final message. Everything else is the thread's, carried over from the entry that covers
 * it (who it is for, the types, where things stood), and its valid-until is "until resolved", 24 elapsed hours from each save and from the submit (a final
 * is never read as the thread's valid-until: the thread is closed when it is approved).
 */
export interface StartFinalInput {
  /** The id the new entry takes, made by the page (as for an update): a request whose id is already this person's final in this thread returns it. */
  entryId: string;
  text: string;
}

/**
 * How a press starts: a submit, with the fingerprint (`draftFingerprint`) of the draft the author saved and saw just before pressing, or a
 * "Try translation again" of the pending version and hash the person was looking at.
 */
export type SubmitMode = { kind: "submit"; draft?: string } | { kind: "retranslate"; seen: ApprovalBinding };

/** What starting a submit settled: an attempt already made with this key (its first result), or the work to do. */
export type SubmitStart =
  | { kind: "replay"; attempt: AttemptView }
  | {
      kind: "started";
      attempt: AttemptView;
      /** The draft as it was when Submit was pressed: the transaction that freezes checks it is still this. */
      expected: EntryContent;
      context: PrepareContext;
      /** The open, non-drill thread this entry may duplicate, or null. */
      possibleDuplicateOf: string | null;
      /** Who the texts say the entry is from (S08.02), as worked out under the lock: the freezing transaction checks it is still so and stores it. */
      attribution: EntryAttribution;
    };

const SLUG_ALPHABET = "23456789bcdfghjkmnpqrstvwxz";
/** Eight letters and numbers with no vowels (so no word) and nothing easily mistaken for another: 27^8, about 2.8e11. */
function randomSlug(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => SLUG_ALPHABET[byte % SLUG_ALPHABET.length]).join("");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * The audience a place choice asks for, with only what the role policy reads of it: the scope and the buildings by rsn.
 * Nothing is looked up, so the policy can be asked before any place is.
 */
function askedFor(choice: PlaceChoice, current: { groups: Audience["groups"]; types: readonly string[] }): Audience {
  const { groups } = current;
  const types = [...current.types];
  return choice.scope === "neighbourhood"
    ? { scope: "neighbourhood", neighbourhood_ids: [...choice.neighbourhoodIds], groups, types }
    : { scope: "buildings", buildings: choice.buildings.map((building) => ({ rsn: building.rsn, floors: null })), groups, types };
}

/** The refusals a trigger's message maps to: the race the use case's own checks lost. */
const TRIGGER_MESSAGES: readonly [RegExp, AlertRefusal][] = [
  [/ALERT_CLOSED/, "ALERT_CLOSED"],
  [/TARGET_NOT_VALID/, "TARGET_NOT_VALID"],
  [/cannot approve/, "EDITOR_CANNOT_APPROVE"],
  [/must name the version and hash/, "ENTRY_CHANGED"],
  [/web-published/, "WEB_PUBLISHED"],
  [/unknown type of disruption/, "UNKNOWN_TYPE"],
  [/not an allowed transition|cannot be changed/, "ILLEGAL_TRANSITION"],
];

/** The refusal a database trigger's error stands for, or null when the error is something else. */
function refusalOfDatabaseError(error: unknown): AlertRefusal | null {
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 5; depth += 1) {
    const { code, message } = current as { code?: unknown; message?: unknown };
    if (code === "23514" && typeof message === "string") {
      const found = TRIGGER_MESSAGES.find(([pattern]) => pattern.test(message));
      if (found) return found[1];
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** A unique key that another transaction took first (Postgres 23505), anywhere in the error's causes: the race of two presses of one new post (S08.02). */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 5; depth += 1) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

type EntryRow = typeof alertEntry.$inferSelect;
type ThreadRow = typeof alert.$inferSelect;

const entryOf = (row: EntryRow): EntryView => ({
  id: row.id,
  alertId: row.alertId,
  kind: row.kind as EntryKind,
  status: row.status as EntryStatus,
  authorId: row.authorId,
  editorIds: row.editorIds,
  content: contentOf(row),
  version: row.version,
  contentHash: row.contentHash,
  submittedAt: row.submittedAt,
  returnedFor: row.returnedFor as ReturnReason | null,
  returnedNote: row.returnedNote,
  approvedBy: row.approvedBy,
  approvedAt: row.approvedAt,
  webPublishedAt: row.webPublishedAt,
  possibleDuplicateOf: row.possibleDuplicateOf,
  supersedesId: row.supersedesId,
  withdrawalReason: row.withdrawalReason as WithdrawalReason | null,
  discardReason: row.discardReason as DiscardReason | null,
  attributedRsn: row.attributedRsn,
});

const contentOf = (row: EntryRow): EntryContent => ({
  text: row.originalText,
  types: row.types,
  audience: row.audience as Audience,
  phase: row.phase as Phase,
  validUntil: row.validUntil,
  validUntilMode: row.validUntilMode as ValidUntilMode,
});

/** The kinds whose approval starts a check-in round or adds to it (S08.06, AD-12): never a withdrawal or a final. */
const ROUND_KINDS: ReadonlySet<string> = new Set<EntryKind>(["ack", "update", "correction"]);

/** The thread of the round an approval starts or adds to (S08.06): its id, and the approved entry's types and audience. */
export interface RoundStart {
  alertId: string;
  types: readonly string[];
  audience: Audience;
}

type AttemptRow = typeof alertSubmitAttempt.$inferSelect;

/** An attempt as the screens read it: a `running` one whose function must be gone (older than its time limit) reads as failed. */
const attemptOf = (row: AttemptRow, at: Date): AttemptView => {
  const abandoned = row.state === "running" && isStaleAttempt(row.startedAt, at);
  return {
    key: row.key,
    kind: row.kind as AttemptKind,
    state: abandoned ? "failed" : (row.state as AttemptState),
    outcome: abandoned ? "SUBMIT_ABANDONED" : (row.outcome as AlertRefusal | null),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    budgetMs: row.budgetMs,
    progress: row.progress as Record<string, string>,
    resultVersion: row.resultVersion,
    resultHash: row.resultHash,
  };
};

const threadOf = (row: ThreadRow): ThreadView => {
  if (row.slug === null) throw new Error("alerting: a thread has no slug");
  return { id: row.id, slug: row.slug, isDrill: row.isDrill, reportedAt: row.reportedAt, status: row.status as "open" | "closed" };
};

type AuditedAction = "alert.created" | "entry.created" | "entry.submitted" | "entry.returned" | "entry.discarded" | "entry.approved";

/** What a correction or a withdrawal replaces, read under the thread's lock: what the rules read of the row. */
const targetFactsOf = (row: EntryRow): TargetFacts => ({ id: row.id, kind: row.kind as EntryKind, status: row.status as EntryStatus, webPublishedAt: row.webPublishedAt });

export function createAlertLifecycle(deps: AlertLifecycleDeps) {
  const { db, audit, staff, places } = deps;
  const recipients = deps.recipients ?? recipientsPort;
  const markApproval = deps.markApproval ?? (async () => undefined);
  const queueAlertTexts = deps.queueAlertTexts;
  const cancelQueued = deps.cancelQueued ?? (async () => undefined);
  const discardWithdrawalText = deps.discardWithdrawalText ?? (() => "This report was withdrawn.");
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => uuidv7());
  const newSlug = deps.newSlug ?? randomSlug;
  const latestValidUntil = deps.latestValidUntil ?? ((at: Date) => addTorontoDays(at, VALID_UNTIL_MAX_DAYS));
  /** The valid-until rule at this moment: in the future, and no later than 7 Toronto days ahead. */
  const validUntilProblem = (validUntil: Date, at: Date) => validUntilRefusal(validUntil, at, latestValidUntil(at));
  /** The `is_drill` of the thread a transaction has read, for the record of a refusal that rolls it back. */
  const drillOf = new WeakMap<DbTransaction, boolean>();
  /** The one way a thread closes (S05.02): inside the use case that decides it, in its transaction and under the thread's lock. */
  const closeAlert = createCloseAlert({ audit, cancelQueued });

  /**
   * Runs one use case in a transaction. A refusal inside rolls it back and is audited as refused,
   * under the action the use case would have recorded, on the entry (or the thread) it named, with
   * the thread's `is_drill` once the use case has read it (`drillOf`); a change with no audited
   * action (saving a draft) records nothing: the acceptance criteria audit the transitions only.
   */
  async function change<T>(
    action: AuditedAction | null,
    actor: AlertActor,
    subject: { type: "alert" | "alert_entry"; id: string },
    run: (tx: DbTransaction) => Promise<T>,
  ): Promise<AlertResult<T>> {
    let refusal: AlertRefusal;
    let detail: Refused["detail"];
    let isDrill = false;
    try {
      return {
        ok: true,
        value: await db.transaction(async (tx) => {
          try {
            return await run(tx);
          } finally {
            isDrill = drillOf.get(tx) ?? false;
          }
        }),
      };
    } catch (error) {
      const known = error instanceof Refused ? error.refusal : refusalOfDatabaseError(error);
      if (!known) throw error;
      refusal = known;
      detail = error instanceof Refused ? error.detail : undefined;
    }
    const failure = (): AlertResult<T> => ({ ok: false, error: refusal, ...(detail ? { detail: { recipients: detail.recipients } } : {}) });
    if (action === null) return failure();
    await audit.recordRefusal(db, {
      action,
      actorStaffId: UUID.test(actor.staffId) ? actor.staffId : null,
      subjectType: subject.type,
      subjectId: UUID.test(subject.id) ? subject.id : null,
      isDrill,
      // The reason is the group the refusal belongs to; `refusal` is the rule that refused (S04.07). A refused approval whose count changed
      // also records the two counts, so the record says from what to what.
      meta: {
        reason: AUDIT_REASON[refusal],
        refusal,
        ...(action === "entry.approved" && detail ? { recipient_count: detail.recipients.total, ...(detail.reviewed ? { reviewed_count: detail.reviewed.total } : {}) } : {}),
      } as never,
    });
    return failure();
  }

  /** The start of every use case on an existing thread: lock it, set the actor, read the actor's standing. */
  async function open(tx: DbTransaction, actor: AlertActor, ref: { alertId: string; entryId?: string }) {
    if (!UUID.test(ref.alertId)) throw new Refused("ALERT_NOT_FOUND");
    // AD-18: the first statement locks the thread.
    const [thread] = await tx.select().from(alert).where(eq(alert.id, ref.alertId)).for("update");
    if (!thread) throw new Refused("ALERT_NOT_FOUND");
    drillOf.set(tx, thread.isDrill);
    await tx.execute(sql`select set_config('cvh.actor_id', ${actor.staffId}, true)`);
    const standing = await staff.standing(tx, actor.staffId);
    if (!standing || standing.status !== "active") throw new Refused("NOT_ALLOWED");
    if (thread.status !== "open") throw new Refused("ALERT_CLOSED");
    if (ref.entryId === undefined) return { thread, standing, entry: undefined };
    if (!UUID.test(ref.entryId)) throw new Refused("ENTRY_NOT_FOUND");
    const [entry] = await tx
      .select()
      .from(alertEntry)
      .where(and(eq(alertEntry.id, ref.entryId), eq(alertEntry.alertId, thread.id)))
      .for("update");
    if (!entry) throw new Refused("ENTRY_NOT_FOUND");
    return { thread, standing, entry };
  }

  /** Whether the person may author this content now: the role policy at the scope the content has (AD-4). */
  function authoringRefusal(standing: StaffStanding, staffId: string, content: Pick<EntryContent, "types" | "audience">): AlertRefusal | null {
    const decision = isWideContent(content)
      ? decidePolicy(standing.role, "alert.author_wide", { actorId: staffId })
      : decidePolicy(standing.role, "alert.author", { actorId: staffId, assignments: standing.assignments, targets: audienceBuildings(content.audience) ?? [] });
    return decision === "allowed" ? null : decision === "forbidden" ? "NOT_ALLOWED" : "OUT_OF_SCOPE";
  }

  const mustAuthor = (standing: StaffStanding, staffId: string, content: Pick<EntryContent, "types" | "audience">) => {
    const refusal = authoringRefusal(standing, staffId, content);
    if (refusal) throw new Refused(refusal);
  };

  /** The places the audience names exist now (S04.04), read through the transaction: a floor removed since the picker was open is caught. */
  async function mustExist(tx: DbTransaction, audience: Audience) {
    const refusal = await placeRefusal(tx, places, audience);
    if (refusal) throw new Refused(refusal);
  }

  /**
   * Who an entry's texts say it is from when this person submits it (S08.02): the Hub, or for an Ambassador "Building ambassador, {building}" of the one
   * building the post is for (ONE_BUILDING_ONLY otherwise), with the building's address as the texts name it. Read under the use case's lock.
   */
  async function attributionIn(tx: DbTransaction, standing: StaffStanding, content: EntryContent): Promise<{ attribution: EntryAttribution; sms: PrepareContext["attribution"] }> {
    const attribution = attributionFor(standing.role, content.audience);
    if (attribution === "ONE_BUILDING_ONLY") throw new Refused("ONE_BUILDING_ONLY");
    if (attribution.role === "hub") return { attribution, sms: { role: "hub" } };
    const address = (await places.addressesOf?.(tx, [attribution.rsn]))?.get(attribution.rsn) ?? attribution.rsn;
    return { attribution, sms: { role: "ambassador", building: address } };
  }

  /**
   * Replaces a draft's content: the shape, the actor's authority over the draft as it is now and for the new scope and
   * buildings, the places, then the write. Whoever saves a change becomes an editor (the trigger adds them). Shared by saving a draft and by
   * choosing its audience, so both are judged by the one rule.
   */
  async function writeDraft(
    tx: DbTransaction,
    standing: StaffStanding,
    actor: AlertActor,
    entry: EntryRow,
    content: EntryContent,
    options: { checkValidUntil: boolean } = { checkValidUntil: false },
  ): Promise<EntryView> {
    if (entry.status !== "draft") throw new Refused("ILLEGAL_TRANSITION");
    // A withdrawal is the target's: who it is for, its types and where things stood are the target's, and only the notice's words are the author's (S05.02).
    // Its valid-until is "until resolved", 24 elapsed hours from each save (and from each submit), so a withdrawal left a day as a draft can still be completed.
    if (entry.kind === "withdrawal") content = { ...contentOf(entry), text: content.text, validUntil: new Date(now().getTime() + UNTIL_RESOLVED_MS), validUntilMode: "resolved" };
    // A final's valid-until is not the author's either (S05.03): "until resolved", 24 elapsed hours from each save and from the submit. Who it is for can change
    // through the pickers, as an update's can.
    if (entry.kind === "final") content = { ...content, validUntil: new Date(now().getTime() + UNTIL_RESOLVED_MS), validUntilMode: "resolved" };
    // Saving the composer's draft judges the time the author entered (in the future, at most 7 days ahead); the audience
    // pickers change who it is for and not when it ends, so they leave a time that has since passed to the submit's own check.
    const invalid = contentRefusal(content) ?? (options.checkValidUntil ? validUntilProblem(content.validUntil, now()) : null);
    if (invalid) throw new Refused(invalid);
    // Changing a draft is authoring it: the actor must be allowed to author what it holds now (an Ambassador cannot take
    // over a Coordinator's neighbourhood draft, or a draft for a building they are not assigned to, by re-aiming it
    // at one they are), and what it will hold.
    mustAuthor(standing, actor.staffId, contentOf(entry));
    mustAuthor(standing, actor.staffId, content);
    // An update that follows other entries keeps the thread's types (S05.01): they are carried over, and a different type is a different disruption.
    // A correction keeps them too (S05.02), and so does a final (S05.03).
    if (entry.kind === "update" || entry.kind === "correction" || entry.kind === "final") {
      const covering = (await readThreadSummary(tx, entry.alertId))?.covering ?? null;
      if (covering !== null && covering.id !== entry.id && [...covering.types].sort().join("\n") !== [...content.types].sort().join("\n")) throw new Refused("TYPES_CHANGED");
    }
    if (entry.kind !== "withdrawal") await mustExist(tx, content.audience);
    const [saved] = await tx
      .update(alertEntry)
      .set({
        originalText: content.text,
        types: [...content.types],
        audience: content.audience,
        phase: content.phase,
        validUntil: content.validUntil,
        // A save that names no mode (the audience pickers) leaves the author's choice as it was.
        ...(content.validUntilMode ? { validUntilMode: content.validUntilMode } : {}),
      })
      .where(eq(alertEntry.id, entry.id))
      .returning();
    return entryOf(saved);
  }

  /** Whether the transition is allowed by lifecycle.ts for this thread and entry. */
  function mustTransition(thread: ThreadRow, entry: EntryRow, to: EntryStatus) {
    const decision = requestTransition({ from: entry.status as EntryStatus, to, webPublished: entry.webPublishedAt !== null, threadOpen: thread.status === "open" });
    if (!decision.ok) throw new Refused(decision.refusal);
  }

  /** A pending, web-published entry's discard is allowed by the state machine as the supersession it is (S08.03): the same transition as a correction's, made by the system. */
  function mustTransitionToSuperseded(thread: ThreadRow, entry: EntryRow) {
    const decision = requestTransition({ from: entry.status as EntryStatus, to: "superseded", webPublished: entry.webPublishedAt !== null, threadOpen: thread.status === "open" });
    if (!decision.ok) throw new Refused(decision.refusal);
  }

  /**
   * The discard of a pending entry residents already read (a D-1 post, S08.03, AD-5 "Web publication"): it never returns to draft and is never `discarded`.
   * In this one transaction, under the thread's lock, a system `withdrawal` (`published_system`: web-only, never approved, so no text is queued or captured for
   * it) supersedes it, residents read "Withdrawn" in its place, `feed_version` goes up and, if no published, non-superseded substantive entry is left, the thread
   * closes `withdrawn` beside it (`closeAlert`). The database makes the withdrawal only while `cvh.system_actor` is `discard` (set here, transaction-local) and the
   * entry's discarder is acting. Locks, in the order of AD-18: the thread (held), every entry of it, then `feed_version`, then `closeAlert`'s own.
   */
  async function discardPublishedIn(tx: DbTransaction, entry: EntryRow, thread: ThreadRow, actor: AlertActor): Promise<EntryView> {
    await tx.select({ id: alertEntry.id }).from(alertEntry).where(eq(alertEntry.alertId, thread.id)).orderBy(alertEntry.id).for("update");
    await tx.execute(sql`select set_config('cvh.system_actor', 'discard', true)`);
    const at = now();
    const withdrawalId = newId();
    await tx.insert(alertEntry).values({
      id: withdrawalId,
      alertId: thread.id,
      kind: "withdrawal",
      status: "published_system",
      supersedesId: entry.id,
      withdrawalReason: "other",
      // The column is required and names an account: the discarded entry's author stands in; nobody acts as them.
      authorId: entry.authorId,
      editorIds: [entry.authorId],
      originalText: discardWithdrawalText(),
      types: [...entry.types],
      audience: entry.audience,
      phase: entry.phase,
      // Like a person's withdrawal: "until resolved", 24 elapsed hours; a withdrawal notice never covers a thread.
      validUntil: new Date(at.getTime() + UNTIL_RESOLVED_MS),
      validUntilMode: "resolved",
    });
    const [superseded] = await tx.update(alertEntry).set({ status: "superseded" }).where(eq(alertEntry.id, entry.id)).returning();
    const bumped = await tx.update(feedVersion).set({ version: sql`${feedVersion.version} + 1` }).where(eq(feedVersion.id, 1)).returning({ version: feedVersion.version });
    if (bumped.length !== 1) throw new Error("alerting: feed_version has no row");
    const reason = discardReasonOf(actor.staffId, entry.authorId);
    await audit.record(tx, {
      action: "entry.discarded",
      actorStaffId: actor.staffId,
      subjectType: "alert_entry",
      subjectId: entry.id,
      isDrill: thread.isDrill,
      meta: { entry_id: entry.id, version: entry.version, from: "pending_approval", discard_reason: reason, withdrawn_by: withdrawalId },
    });
    await audit.record(tx, {
      action: "entry.superseded",
      actorStaffId: actor.staffId,
      subjectType: "alert_entry",
      subjectId: entry.id,
      isDrill: thread.isDrill,
      meta: { entry_id: entry.id, by: withdrawalId, by_kind: "withdrawal", withdrawal_reason: "other", system: true },
    });
    // A discard that leaves nothing residents can still act on closes the thread, as an approved withdrawal does; the system withdrawal is the entry that closes it.
    const after = await tx.select().from(alertEntry).where(eq(alertEntry.alertId, thread.id));
    if (!substantiveRemains(after.map((row) => ({ id: row.id, kind: row.kind as EntryKind, status: row.status as EntryStatus, webPublishedAt: row.webPublishedAt })), [entry.id])) {
      await closeAlert(tx, actor, { alertId: thread.id, reason: "withdrawn", keepEntryId: withdrawalId, feedRaised: true });
    }
    return entryOf(superseded);
  }

  /** Only an editor (the author or someone who changed the entry) acts on its draft or pulls its submit back. */
  const mustBeEditor = (entry: EntryRow, staffId: string) => {
    if (!entry.editorIds.includes(staffId)) throw new Refused("OUT_OF_SCOPE");
  };

  /**
   * The entry a correction or a withdrawal names, locked under the thread's lock (S05.02): the role policy first (a Director never; an Ambassador only their own
   * pending entry, S08.04: `own_pending_entry`, asked of the locked entry, so another person's entry, a missing one and one that is not pending all read as
   * `OUT_OF_SCOPE` and nothing of the thread is learned), then whether it is a valid target (E05: pending only when residents already read it), so someone who may
   * not learns nothing of the thread's entries.
   */
  async function lockedTarget(tx: DbTransaction, thread: ThreadRow, standing: StaffStanding, actor: AlertActor, targetId: string, action: "alert.correct" | "alert.withdraw"): Promise<EntryRow> {
    const asked = decidePolicy(standing.role, action, { actorId: actor.staffId });
    if (asked === "forbidden") throw new Refused("NOT_ALLOWED");
    if (!UUID.test(targetId)) throw new Refused(asked === "out_of_scope" ? "OUT_OF_SCOPE" : "TARGET_NOT_VALID");
    const [target] = await tx
      .select()
      .from(alertEntry)
      .where(and(eq(alertEntry.id, targetId), eq(alertEntry.alertId, thread.id)))
      .for("update");
    if (target) {
      const decision = decidePolicy(standing.role, action, { actorId: actor.staffId, entry: { authorId: target.authorId, editorIds: target.editorIds, status: target.status } });
      if (decision === "forbidden") throw new Refused("NOT_ALLOWED");
      if (decision === "out_of_scope") throw new Refused("OUT_OF_SCOPE");
    } else if (asked === "out_of_scope") {
      throw new Refused("OUT_OF_SCOPE");
    }
    const refusal = targetRefusal(target ? targetFactsOf(target) : null);
    if (refusal) throw new Refused(refusal);
    return target;
  }

  /** A correction or a withdrawal still names a valid target of its thread (S05.02): refused with the reason when the entry was corrected or withdrawn since, or is not one residents read. */
  async function mustHaveValidTarget(tx: DbTransaction, thread: ThreadRow, row: EntryRow) {
    if (!isSupersedingKind(row.kind)) return;
    const [target] = row.supersedesId === null ? [] : await tx.select().from(alertEntry).where(and(eq(alertEntry.id, row.supersedesId), eq(alertEntry.alertId, thread.id)));
    const refusal = targetRefusal(target ? targetFactsOf(target) : null);
    if (refusal) throw new Refused(refusal);
  }

  /**
   * Whether this submit publishes the entry on the web at once, as "Not yet verified" (D-1, S08.03): `isD1Eligible` over the facts read under the lock. The author is
   * the one who submits and the texts say "Building ambassador, {building}" (an entry another person submits is the Hub's, and waits); a place that cannot tell
   * which types are direct (`places.directOf` left out) counts none as direct, so nothing is published.
   */
  async function isD1In(tx: DbTransaction, entry: EntryRow, thread: ThreadRow, standing: StaffStanding, actor: AlertActor, attribution: EntryAttribution): Promise<boolean> {
    if (thread.isDrill || attribution.role !== "ambassador" || entry.authorId !== actor.staffId) return false;
    const direct = (await places.directOf?.(tx, entry.types)) ?? new Map<string, boolean | null>();
    return isD1Eligible({ authorRole: standing.role, isDrill: thread.isDrill, kind: entry.kind as EntryKind, types: entry.types, direct });
  }

  async function submitIn(
    tx: DbTransaction,
    entry: EntryRow,
    thread: ThreadRow,
    actor: AlertActor,
    frozen: FrozenContent,
    expected: EntryContent,
    duplicateOf: string | null,
    attribution: EntryAttribution,
    webPublish: boolean,
  ): Promise<EntryView> {
    mustTransition(thread, entry, "pending_approval");
    const content = contentOf(entry);
    if (!sameContent(expected, content)) throw new Refused("DRAFT_CHANGED");
    const invalid = contentRefusal(content) ?? validUntilProblem(content.validUntil, now());
    if (invalid) throw new Refused(invalid);
    // A withdrawal goes to the people the withdrawn entry went to: the places its audience names may be gone since, and that must not stop it (S05.02).
    await mustHaveValidTarget(tx, thread, entry);
    if (entry.kind !== "withdrawal") await mustExist(tx, content.audience);
    if (!SHA256.test(frozen.contentHash) || !("en" in frozen.smsBodies) || frozen.translations.length === 0) {
      throw new Error("alerting: a submit freezes a SHA-256 content hash, an English SMS body and the translations");
    }
    await tx.delete(alertEntryTranslation).where(eq(alertEntryTranslation.entryId, entry.id));
    await tx.insert(alertEntryTranslation).values(
      frozen.translations.map((translation) => ({
        entryId: entry.id,
        lang: translation.lang,
        body: translation.body,
        machine: translation.machine,
        model: translation.model,
        status: translation.status,
        sourceHash: translation.sourceHash,
        conversion: translation.conversion
          ? { from: translation.conversion.from, from_text_hash: translation.conversion.fromTextHash, opencc_version: translation.conversion.openccVersion, config: translation.conversion.config }
          : null,
      })),
    );
    const [submitted] = await tx
      .update(alertEntry)
      .set({
        status: "pending_approval",
        version: entry.version + 1,
        contentHash: frozen.contentHash,
        smsBodies: frozen.smsBodies,
        submittedAt: now(),
        returnedFor: null,
        returnedNote: null,
        possibleDuplicateOf: duplicateOf,
        // Who the texts just frozen say the entry is from (S08.02): the approval view and residents read this, never the author's role at the time.
        attributedRsn: rsnOfAttribution(attribution),
        // D-1 (S08.03): residents read the post at once, as "Not yet verified". The entry trigger times it with the database's clock and repeats the rule's facts.
        ...(webPublish ? { webPublishedAt: sql`now()` } : {}),
      })
      .where(eq(alertEntry.id, entry.id))
      .returning();
    // The web shows something new: `feed_version` goes up in this same transaction (AD-17, after the thread's and the entry's locks: the lock order of AD-18).
    if (webPublish) {
      const bumped = await tx.update(feedVersion).set({ version: sql`${feedVersion.version} + 1` }).where(eq(feedVersion.id, 1)).returning({ version: feedVersion.version });
      if (bumped.length !== 1) throw new Error("alerting: feed_version has no row");
    }
    await audit.record(tx, {
      action: "entry.submitted",
      actorStaffId: actor.staffId,
      subjectType: "alert_entry",
      subjectId: entry.id,
      isDrill: thread.isDrill,
      meta: { entry_id: entry.id, version: submitted.version, content_hash: frozen.contentHash, ...(webPublish ? { web_published: true as const } : {}) },
    });
    return entryOf(submitted);
  }

  /** Returns a pending entry to draft. An approver's `return` carries `note` (what the author reads); the other reasons carry none. */
  async function returnIn(tx: DbTransaction, entry: EntryRow, thread: ThreadRow, actor: AlertActor, reason: ReturnReason, note: string | null = null): Promise<EntryView> {
    mustTransition(thread, entry, "draft");
    const [returned] = await tx
      .update(alertEntry)
      .set({ status: "draft", returnedFor: reason, returnedNote: note, contentHash: null, smsBodies: null, submittedAt: null, possibleDuplicateOf: null, attributedRsn: null })
      .where(eq(alertEntry.id, entry.id))
      .returning();
    await audit.record(tx, {
      action: "entry.returned",
      actorStaffId: actor.staffId,
      subjectType: "alert_entry",
      subjectId: entry.id,
      isDrill: thread.isDrill,
      meta: { entry_id: entry.id, version: entry.version, returned_for: reason, ...(note !== null ? { with_note: true as const } : {}) },
    });
    return entryOf(returned);
  }

  /** The approval policy for this actor on this entry, as the guard asks it, with the assurance rule after it. */
  function mustMayApprove(standing: StaffStanding, actor: AlertActor, entry: EntryRow) {
    const policyEntry = { authorId: entry.authorId, editorIds: entry.editorIds, status: entry.status };
    const decision = decidePolicy(standing.role, "alert.approve", { actorId: actor.staffId, entry: policyEntry });
    if (decision === "forbidden") throw new Refused("NOT_ALLOWED");
    if (!meetsAssurance(standing.role, actor.aal, "alert.approve")) throw new Refused("AAL2_REQUIRED");
    // "Not an editor" is the only context the rule holds on; the editor refusal comes with its own code.
    if (decision === "out_of_scope") throw new Refused("EDITOR_CANNOT_APPROVE");
  }

  /**
   * Starting a drill (S06.05, AD-4, AD-6): the policy action `drill.run` (Admins), from an `aal2` session. A thread's `is_drill` is set here and never changes,
   * so this is the only place a drill can begin; nobody else can make one by asking for `isDrill`, whatever the screen or the request said.
   */
  function mustMayRunDrill(standing: StaffStanding, actor: AlertActor) {
    if (decidePolicy(standing.role, "drill.run") !== "allowed") throw new Refused("NOT_ALLOWED");
    if (!meetsAssurance(standing.role, actor.aal, "drill.run")) throw new Refused("AAL2_REQUIRED");
  }

  /**
   * The approver was shown a version and hash of a pending entry (S04.07): an entry that changed since (pulled back to a draft, or edited and
   * submitted again while the approver read: ENTRY_CHANGED) or is not waiting any more (approved or discarded: ENTRY_NOT_PENDING) is refused.
   * Only judged where a person names what they saw.
   */
  function mustMatchShown(row: EntryRow, shown: ApprovalBinding | undefined) {
    if (shown === undefined) return;
    const refusal = checkShownBinding({ status: row.status as EntryStatus, version: row.version, contentHash: row.contentHash, shownVersion: shown.version, shownHash: shown.contentHash });
    if (refusal) throw new Refused(refusal);
  }

  /** The note of a return: control characters taken out, trimmed, present, and at most RETURN_NOTE_MAX characters (counted as the database counts them). */
  function noteOf(raw: string | undefined): string {
    // Control characters are taken out (the database cannot hold NUL); a person's own line breaks stay.
    const text = (raw ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
    if (text === "") throw new Refused("NOTE_REQUIRED");
    if ([...text].length > RETURN_NOTE_MAX) throw new Refused("NOTE_TOO_LONG");
    return text;
  }

  /**
   * The entry as the recipient port takes it (S04.07): the audience and the frozen texts as stored, never from a request. A correction or a withdrawal names the
   * entry it replaces (S05.02), whose recipients the port adds to the entry's own; a final adds those of every other entry of its thread (S07.07), read here in the
   * caller's transaction under the thread's lock.
   */
  const recipientEntryOf = async (executor: DbExecutor, row: EntryRow, thread: ThreadRow): Promise<RecipientEntry> => ({
    entryId: row.id,
    alertId: row.alertId,
    kind: row.kind,
    isDrill: thread.isDrill,
    supersedesId: row.supersedesId,
    ...(row.kind === "final" && !thread.isDrill
      ? { priorEntryIds: (await executor.select({ id: alertEntry.id }).from(alertEntry).where(and(eq(alertEntry.alertId, row.alertId), ne(alertEntry.id, row.id)))).map((other) => other.id) }
      : {}),
    audience: row.audience as Audience,
    types: row.types,
    smsBodies: (row.smsBodies ?? {}) as Record<string, RecipientSmsBody>,
  });

  /**
   * The snapshot of an approval (AD-7, S06.01): the people the recipient port captures in this transaction, queued as texts through the outbox
   * (`queueAlertTexts`: messaging's `enqueueAlertDeliveries(tx, entryId, texts)`), each in the entry's frozen text message for the person's language,
   * and the count of the texts the outbox returns, in all and by the language of the body: the count that is audited and compared with the reviewed
   * one. The marker that lets the database accept an alert delivery has been set by now. Nobody captured (all of E04 to E06: texting is not open):
   * nothing is written.
   */
  async function queueSnapshot(tx: DbTransaction, entry: RecipientEntry): Promise<{ counts: RecipientCounts; costCents: number }> {
    const captured = await recipients.capture(entry, tx);
    const texts = alertTextsOf({ recipients: captured, smsBodies: entry.smsBodies, pricePerSegmentCents: deps.pricePerSegmentCents });
    if (texts.length === 0) return { counts: NO_RECIPIENTS, costCents: 0 };
    if (!queueAlertTexts) throw new Error("alerting: people were captured for an approval but no outbox is wired to queue their texts");
    return { counts: countsOfTexts(await queueAlertTexts(tx, entry.entryId, texts)), costCents: texts.reduce((sum, text) => sum + text.costEstimateCents, 0) };
  }

  /** Inserts a draft (the author its first editor): the one place an entry row is made, for a thread's first entry and for an update. The caller has judged everything. */
  async function insertEntry(
    tx: DbTransaction,
    actor: AlertActor,
    ids: { alertId: string; entryId: string; createdAt: Date },
    kind: (typeof AUTHORED_KINDS)[number] | "correction" | "withdrawal" | "final",
    content: EntryContent,
    replaces?: { supersedesId: string; withdrawalReason?: WithdrawalReason },
  ): Promise<EntryRow> {
    const [entry] = await tx
      .insert(alertEntry)
      .values({
        id: ids.entryId,
        alertId: ids.alertId,
        kind,
        authorId: actor.staffId,
        editorIds: [actor.staffId],
        originalText: content.text,
        types: [...content.types],
        audience: content.audience,
        phase: content.phase,
        validUntil: content.validUntil,
        validUntilMode: content.validUntilMode ?? "at",
        createdAt: ids.createdAt,
        ...(replaces ? { supersedesId: replaces.supersedesId, withdrawalReason: replaces.withdrawalReason ?? null } : {}),
      })
      .returning();
    return entry;
  }

  /** Inserts the thread and its first draft (the author its first editor), audited as `alert.created`. The caller has judged everything. */
  async function insertThread(
    tx: DbTransaction,
    actor: AlertActor,
    input: { kind: (typeof AUTHORED_KINDS)[number]; isDrill: boolean; reportedAt: Date; content: EntryContent },
    ids: { alertId: string; entryId: string; createdAt: Date },
  ): Promise<{ thread: ThreadView; entry: EntryView }> {
    await tx.execute(sql`select set_config('cvh.actor_id', ${actor.staffId}, true)`);
    const [thread] = await tx
      .insert(alert)
      .values({ id: ids.alertId, isDrill: input.isDrill, reportedAt: input.reportedAt, createdBy: actor.staffId, slug: newSlug() })
      .returning();
    const entry = await insertEntry(tx, actor, ids, input.kind, input.content);
    await audit.record(tx, {
      action: "alert.created",
      actorStaffId: actor.staffId,
      subjectType: "alert",
      subjectId: ids.alertId,
      isDrill: input.isDrill,
      meta: { entry_id: ids.entryId, kind: input.kind, types: [...input.content.types] },
    });
    return { thread: threadOf(thread), entry: entryOf(entry) };
  }

  // ---- Submit attempts (S04.05) ---------------------------------------------------------------------------------------

  /**
   * The open, non-drill thread an entry of these types and this audience may duplicate (advisory: nothing is refused for it). Only a new
   * thread's first entry has one, and only an older thread can be what it duplicates: "a new thread overlapping an open ... thread"
   * (spine, Duplicates). An update on a thread that is already running is not a new thread, and must not send the approver to a newer
   * thread that overlaps it, which would point at withdrawing the wrong one.
   */
  async function findPossibleDuplicate(tx: DbTransaction, thread: ThreadRow, entry: EntryRow, content: EntryContent): Promise<string | null> {
    if (thread.isDrill) return null;
    const [earlier] = await tx
      .select({ id: alertEntry.id })
      .from(alertEntry)
      .where(
        and(
          eq(alertEntry.alertId, thread.id),
          ne(alertEntry.id, entry.id),
          or(lt(alertEntry.createdAt, entry.createdAt), and(eq(alertEntry.createdAt, entry.createdAt), lt(alertEntry.id, entry.id))),
        ),
      )
      .limit(1);
    if (earlier) return null;
    const rows = await tx
      .select({ alertId: alertEntry.alertId, audience: alertEntry.audience })
      .from(alertEntry)
      .innerJoin(alert, eq(alert.id, alertEntry.alertId))
      .where(
        and(
          eq(alert.status, "open"),
          eq(alert.isDrill, false),
          ne(alert.id, thread.id),
          lt(alert.createdAt, thread.createdAt),
          inArray(alertEntry.status, ["pending_approval", "approved"]),
          arrayOverlaps(alertEntry.types, [...content.types]),
        ),
      )
      .orderBy(desc(alertEntry.createdAt))
      .limit(200);
    const candidates = rows.map((row) => ({ alertId: row.alertId, audience: row.audience as Audience }));
    const rsns = new Set([...audienceRsns(content.audience), ...candidates.flatMap((candidate) => audienceRsns(candidate.audience))]);
    const neighbourhoods = await places.neighbourhoodsOf(tx, [...rsns]);
    return possibleDuplicateOf({ alertId: thread.id, audience: content.audience }, candidates, (rsn) => neighbourhoods.get(rsn) ?? null);
  }

  /**
   * Starts one press of Submit (or of "Try translation again"): in one short transaction under the thread's lock it settles whether
   * the key was already used (then the first attempt's result is returned and nothing else happens), whether another attempt is
   * running (refused: SUBMIT_IN_PROGRESS), and whether the draft can be submitted at all (so no translation is paid for a draft
   * that would be refused), then records the attempt as `running` and returns the draft as it was when Submit was pressed,
   * what the preparation needs to know (read from the database) and the possible duplicate. A "Try translation again" first
   * returns the pending entry to draft in this same transaction, the person becoming an editor.
   */
  async function beginSubmit(
    actor: AlertActor,
    ref: EntryRef,
    key: string,
    mode: SubmitMode,
  ): Promise<AlertResult<SubmitStart>> {
    return change(mode.kind === "submit" ? "entry.submitted" : "entry.returned", actor, { type: "alert_entry", id: ref.entryId }, async (tx): Promise<SubmitStart> => {
      if (!SUBMIT_KEY_PATTERN.test(key)) throw new Refused("SUBMIT_KEY_INVALID");
      const { thread, standing, entry } = await open(tx, actor, ref);
      const row = entry!;
      const at = now();
      const markAbandoned = async (attemptKey: string) => {
        const [failed] = await tx
          .update(alertSubmitAttempt)
          .set({ state: "failed", outcome: "SUBMIT_ABANDONED" })
          .where(and(eq(alertSubmitAttempt.entryId, row.id), eq(alertSubmitAttempt.key, attemptKey), eq(alertSubmitAttempt.state, "running")))
          .returning();
        return failed;
      };
      // The same key as an earlier press: that attempt's result, whatever the entry has become since.
      const [same] = await tx.select().from(alertSubmitAttempt).where(and(eq(alertSubmitAttempt.entryId, row.id), eq(alertSubmitAttempt.key, key))).for("update");
      if (same) {
        if (same.actorId !== actor.staffId) throw new Refused("OUT_OF_SCOPE");
        const settled = same.state === "running" && isStaleAttempt(same.startedAt, at) ? ((await markAbandoned(key)) ?? same) : same;
        return { kind: "replay", attempt: attemptOf(settled, at) };
      }
      // One attempt at a time: a press while another runs waits for it, unless its function is gone.
      const [running] = await tx.select().from(alertSubmitAttempt).where(and(eq(alertSubmitAttempt.entryId, row.id), eq(alertSubmitAttempt.state, "running"))).for("update");
      if (running) {
        if (!isStaleAttempt(running.startedAt, at)) throw new Refused("SUBMIT_IN_PROGRESS");
        await markAbandoned(running.key);
      }
      let content: EntryContent;
      if (mode.kind === "submit") {
        mustBeEditor(row, actor.staffId);
        mustAuthor(standing, actor.staffId, contentOf(row));
        mustTransition(thread, row, "pending_approval");
        content = contentOf(row);
        // The draft the author saved and saw is the draft that is submitted: someone else saving in between is refused, nothing frozen.
        if (mode.draft !== undefined && mode.draft !== draftFingerprint(content)) throw new Refused("DRAFT_CHANGED");
        // A withdrawal's (and a final's) "until resolved" runs 24 elapsed hours from this press (before the content is hashed), so one drafted long ago is not stuck.
        if (row.kind === "withdrawal" || row.kind === "final") {
          const [renewed] = await tx.update(alertEntry).set({ validUntil: new Date(at.getTime() + UNTIL_RESOLVED_MS), validUntilMode: "resolved" }).where(eq(alertEntry.id, row.id)).returning();
          content = contentOf(renewed);
        }
      } else {
        if (row.status !== "pending_approval") throw new Refused("ENTRY_NOT_PENDING");
        if (row.version !== mode.seen.version || row.contentHash !== mode.seen.contentHash) throw new Refused("ENTRY_CHANGED");
        mustAuthor(standing, actor.staffId, contentOf(row));
        content = (await returnIn(tx, row, thread, actor, "retranslate")).content;
      }
      const invalid = contentRefusal(content) ?? validUntilProblem(content.validUntil, at);
      if (invalid) throw new Refused(invalid);
      // A correction or a withdrawal of an entry that is no longer a valid target is refused before anything is paid for or frozen (S05.02).
      await mustHaveValidTarget(tx, thread, row);
      if (row.kind !== "withdrawal") await mustExist(tx, content.audience);
      // Who the texts say it is from (S08.02): an Ambassador's post is "Building ambassador, {building}" of its one building, the Hub's is the Hub's. The texts
      // are frozen for approval ("Verified by the Hub"), and are queued only by it. An ambassador's post that is D-1 is on the web from the freezing transaction,
      // marked "Not yet verified" (S08.03, `isD1In`); its texts still wait.
      const { attribution, sms: smsAttribution } = await attributionIn(tx, standing, content);
      const duplicateOf = await findPossibleDuplicate(tx, thread, row, content);
      const slug = thread.slug;
      if (slug === null) throw new Error("alerting: a thread has no slug");
      const [created] = await tx.insert(alertSubmitAttempt).values({ entryId: row.id, key, kind: mode.kind, actorId: actor.staffId }).returning();
      const context: PrepareContext = {
        alertId: thread.id,
        entryId: row.id,
        isDrill: thread.isDrill,
        kind: row.kind as EntryKind,
        supersedesId: row.supersedesId ?? null,
        channels: ENTRY_CHANNELS,
        slug,
        verified: true,
        attribution: smsAttribution,
      };
      return { kind: "started", attempt: attemptOf(created, at), expected: content, context, possibleDuplicateOf: duplicateOf, attribution };
    });
  }

  /**
   * Ends an attempt that did not freeze anything: `running` becomes `failed` with the reason, and the answer says whether this call did it
   * (false: the attempt was no longer running, because it committed, ended already or was taken as abandoned, or the write could not be
   * made). Only the person who pressed it can end it. It touches the attempt row alone (no thread lock), so it can never wait on, or
   * deadlock with, the transaction that freezes the entry: whichever reaches the row first wins, and a freeze that comes second finds the
   * attempt failed and is refused.
   */
  async function markFailed(actor: AlertActor, ref: EntryRef, key: string, outcome: AlertRefusal): Promise<boolean> {
    try {
      const ended = await db
        .update(alertSubmitAttempt)
        .set({ state: "failed", outcome })
        .where(and(eq(alertSubmitAttempt.entryId, ref.entryId), eq(alertSubmitAttempt.key, key), eq(alertSubmitAttempt.state, "running"), eq(alertSubmitAttempt.actorId, actor.staffId)))
        .returning({ key: alertSubmitAttempt.key });
      return ended.length > 0;
    } catch {
      // The attempt stays `running` and reads as abandoned after the submit function's time limit: the entry is never stuck.
      return false;
    }
  }

  /**
   * Freezes the prepared content (translated, rendered and hashed outside any lock) in one short transaction: it checks the attempt
   * is still this person's running one, that the draft has not changed since Submit was pressed (DRAFT_CHANGED, "This alert
   * changed while it was being prepared. Submit again.", nothing frozen), writes the frozen content as the next version with its
   * hash, moves the entry to `pending_approval` and records the attempt as committed. Any refusal ends the attempt as failed.
   */
  async function completeSubmit(
    actor: AlertActor,
    ref: EntryRef,
    key: string,
    frozen: FrozenContent,
    expected: EntryContent,
    duplicateOf: string | null,
    attributedAs?: EntryAttribution,
  ): Promise<AlertResult<EntryView>> {
    const done = await change("entry.submitted", actor, { type: "alert_entry", id: ref.entryId }, async (tx) => {
      const { thread, standing, entry } = await open(tx, actor, ref);
      const [attempt] = await tx.select().from(alertSubmitAttempt).where(and(eq(alertSubmitAttempt.entryId, ref.entryId), eq(alertSubmitAttempt.key, key))).for("update");
      if (!attempt || attempt.actorId !== actor.staffId || attempt.state !== "running") throw new Refused("SUBMIT_ABANDONED");
      mustBeEditor(entry!, actor.staffId);
      mustAuthor(standing, actor.staffId, contentOf(entry!));
      // The texts being frozen name who the entry is from as `beginSubmit` worked it out (`attributedAs`); if the person's role changed in between, they would
      // say something the entry no longer is, so nothing is frozen (DRAFT_CHANGED: submit again). Without one (a caller that froze no attribution), it is worked out now.
      const attributedNow = (await attributionIn(tx, standing, contentOf(entry!))).attribution;
      if (attributedAs !== undefined && !sameAttribution(attributedAs, attributedNow)) throw new Refused("DRAFT_CHANGED");
      const webPublish = await isD1In(tx, entry!, thread, standing, actor, attributedNow);
      const view = await submitIn(tx, entry!, thread, actor, frozen, expected, duplicateOf, attributedNow, webPublish);
      await tx
        .update(alertSubmitAttempt)
        .set({ state: "committed", resultVersion: view.version, resultHash: frozen.contentHash })
        .where(and(eq(alertSubmitAttempt.entryId, ref.entryId), eq(alertSubmitAttempt.key, key)));
      return view;
    });
    if (!done.ok) await markFailed(actor, ref, key, done.error);
    return done;
  }

  /**
   * Ends an attempt that could not freeze anything (the preparation failed or was refused), and records the refusal (S01.04), both only
   * when this call ended it: an attempt that had already committed (a freezing transaction whose answer was lost) or ended is left as it is,
   * with no refusal added to its audit trail. True when this call ended the attempt.
   */
  async function failSubmit(actor: AlertActor, ref: EntryRef, key: string, outcome: AlertRefusal, isDrill = false): Promise<boolean> {
    if (!(await markFailed(actor, ref, key, outcome))) return false;
    await audit.recordRefusal(db, {
      action: "entry.submitted",
      actorStaffId: UUID.test(actor.staffId) ? actor.staffId : null,
      subjectType: "alert_entry",
      subjectId: UUID.test(ref.entryId) ? ref.entryId : null,
      isDrill,
      meta: { reason: AUDIT_REASON[outcome], refusal: outcome },
    });
    return true;
  }

  /** One try of an ambassador's post (`postFromAmbassador`), in its own transaction under the thread's lock. */
  async function postOnce(actor: AlertActor, input: AmbassadorPostInput): Promise<AlertResult<{ thread: ThreadView; entry: EntryView }>> {
    const creating = input.into === null;
    const threadId = input.into ?? input.alertId;
    const subject = creating ? { type: "alert" as const, id: input.alertId } : { type: "alert_entry" as const, id: input.entryId };
    return change(creating ? "alert.created" : "entry.created", actor, subject, async (tx) => {
      if (!UUID.test(threadId) || !UUID.test(input.entryId)) throw new Refused("ENTRY_ID_INVALID");
      // AD-18: the thread is locked first. A new thread's row does not exist yet, so its id (the page's) is locked instead, for the transaction: the same
      // post sent twice at once makes it once, the second press waiting and then finding it.
      if (creating) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`alert:${threadId}`}, 0))`);
      // ... then the thread's row, when it exists (made by an earlier press of the same post, or the open thread an update goes in).
      const [existingThread] = await tx.select({ id: alert.id }).from(alert).where(eq(alert.id, threadId)).for("update");
      const at = now();
      const contentFor = async (standing: StaffStanding, types: readonly string[]): Promise<EntryContent> => {
        const sorted = [...new Set(types)].sort();
        if (sorted.length !== types.length) throw new Refused("TYPES_REPEATED");
        if (sorted.length === 0) throw new Refused("TYPES_EMPTY");
        const choice: PlaceChoice = { scope: "buildings", buildings: [input.place] };
        // The policy first, on the building asked for, so someone who may not post there learns nothing of its floors.
        mustAuthor(standing, actor.staffId, { types: sorted, audience: askedFor(choice, { groups: [], types: sorted }) });
        const resolved = await resolvePlace(tx, places, choice, { groups: [], types: sorted });
        if (!resolved.ok) throw new Refused(resolved.error);
        const content: EntryContent = { text: input.text, types: sorted, audience: resolved.value, phase: input.phase, validUntil: input.validUntil, validUntilMode: input.validUntilMode };
        const invalid = contentRefusal(content) ?? validUntilProblem(content.validUntil, at);
        if (invalid) throw new Refused(invalid);
        mustAuthor(standing, actor.staffId, content);
        return content;
      };

      if (!existingThread) {
        if (!creating) throw new Refused("ALERT_NOT_FOUND");
        drillOf.set(tx, false);
        const standing = await staff.standing(tx, actor.staffId);
        if (!standing || standing.status !== "active" || standing.role !== "ambassador") throw new Refused("NOT_ALLOWED");
        // An entry id another thread already holds is not this post's.
        const [taken] = await tx.select({ id: alertEntry.id }).from(alertEntry).where(eq(alertEntry.id, input.entryId));
        if (taken) throw new Refused("ENTRY_ID_INVALID");
        const content = await contentFor(standing, input.types);
        // The report reached the Hub as it is posted: by the database's clock, which also times the thread's creation (a report is never after its thread).
        const rows = await tx.execute<{ now: Date | string }>(sql`select now() as now`);
        const reportedAt = new Date([...rows][0].now);
        return insertThread(tx, actor, { kind: "update", isDrill: false, reportedAt, content }, { alertId: input.alertId, entryId: input.entryId, createdAt: at });
      }

      const { thread, standing } = await open(tx, actor, { alertId: threadId });
      if (standing.role !== "ambassador") throw new Refused("NOT_ALLOWED");
      const [existing] = await tx.select().from(alertEntry).where(eq(alertEntry.id, input.entryId)).for("update");
      if (existing) {
        if (existing.alertId !== thread.id || existing.authorId !== actor.staffId || existing.kind !== "update") throw new Refused("ENTRY_ID_INVALID");
        // The same press again: what it made stands. A draft (its submit failed, or never ran) takes what was sent now, its types kept.
        if (existing.status !== "draft") return { thread: threadOf(thread), entry: entryOf(existing) };
        const content = await contentFor(standing, existing.types);
        return { thread: threadOf(thread), entry: await writeDraft(tx, standing, actor, existing, content, { checkValidUntil: true }) };
      }
      // The page made a new thread's id that is already a thread: not this post's.
      if (creating) throw new Refused("ENTRY_ID_INVALID");
      // An update to a running thread starts from what covers it (S05.01): its types; the place is the ambassador's, for their building.
      const covering = coveringEntry(publishedSummaries(await tx.select().from(alertEntry).where(eq(alertEntry.alertId, thread.id))));
      if (covering === null) throw new Refused("NO_PUBLISHED_ENTRY");
      const content = await contentFor(standing, covering.types);
      // The thread must be about the building the post is for (one they are assigned to: `contentFor` checked it), so a request naming another thread's id
      // cannot put a post in an alert about somewhere else; the page only offers the threads about their buildings, the server holds to it.
      const neighbourhoodId = (await places.neighbourhoodsOf(tx, [input.place.rsn])).get(input.place.rsn) ?? null;
      if (!audienceCoversBuilding(covering.audience as Audience, { rsn: input.place.rsn, neighbourhoodId })) throw new Refused("OUT_OF_SCOPE");
      const row = await insertEntry(tx, actor, { alertId: thread.id, entryId: input.entryId, createdAt: at }, "update", content);
      await audit.record(tx, {
        action: "entry.created",
        actorStaffId: actor.staffId,
        subjectType: "alert_entry",
        subjectId: row.id,
        isDrill: thread.isDrill,
        meta: { entry_id: row.id, kind: "update", types: [...content.types] },
      });
      return { thread: threadOf(thread), entry: entryOf(row) };
    });
  }

  return {
    /**
     * Creates a thread and its first draft (`[*] -> draft`) when a disruption is logged. The author must
     * be allowed to author this content (role, and for an Ambassador the assigned buildings), and
     * becomes its first editor. Audited as `alert.created`.
     */
    async createAlert(actor: AlertActor, input: NewAlertInput): Promise<AlertResult<{ thread: ThreadView; entry: EntryView }>> {
      const alertId = newId();
      const entryId = newId();
      return change("alert.created", actor, { type: "alert", id: alertId }, async (tx) => {
        drillOf.set(tx, input.isDrill);
        const createdAt = now();
        const standing = await staff.standing(tx, actor.staffId);
        if (!standing || standing.status !== "active") throw new Refused("NOT_ALLOWED");
        if (input.isDrill) mustMayRunDrill(standing, actor);
        if (!(AUTHORED_KINDS as readonly string[]).includes(input.kind)) throw new Refused("ILLEGAL_TRANSITION");
        if (Number.isNaN(input.reportedAt.getTime()) || input.reportedAt.getTime() > createdAt.getTime()) throw new Refused("REPORTED_AT_INVALID");
        const invalid = contentRefusal(input.content) ?? validUntilProblem(input.content.validUntil, createdAt);
        if (invalid) throw new Refused(invalid);
        mustAuthor(standing, actor.staffId, input.content);
        await mustExist(tx, input.content.audience);
        return insertThread(tx, actor, { kind: input.kind, isDrill: input.isDrill, reportedAt: input.reportedAt, content: input.content }, { alertId, entryId, createdAt });
      });
    },

    /**
     * "Log a disruption" (O-11, S04.05): creates a thread and its first draft from what the person chose (the types, the place and
     * the time of the first report). The audience is made from the place inside this transaction, the way chooseAudiencePlace
     * makes it, and the first text is `input.textFor(audience)`: the suggested acknowledgement, which the author edits next. The
     * draft starts valid until "until resolved" (24 elapsed hours from now) unless a time is given. Refused for a role that may not
     * author this place or these types, a time of first report that is not a time or is later than now, and everything
     * createAlert refuses. Audited as `alert.created`.
     */
    async logDisruption(actor: AlertActor, input: LogDisruptionInput): Promise<AlertResult<{ thread: ThreadView; entry: EntryView }>> {
      const alertId = newId();
      const entryId = newId();
      return change("alert.created", actor, { type: "alert", id: alertId }, async (tx) => {
        drillOf.set(tx, input.isDrill);
        const createdAt = now();
        const standing = await staff.standing(tx, actor.staffId);
        if (!standing || standing.status !== "active") throw new Refused("NOT_ALLOWED");
        if (input.isDrill) mustMayRunDrill(standing, actor);
        if (!(AUTHORED_KINDS as readonly string[]).includes(input.kind)) throw new Refused("ILLEGAL_TRANSITION");
        if (Number.isNaN(input.reportedAt.getTime()) || input.reportedAt.getTime() > createdAt.getTime()) throw new Refused("REPORTED_AT_INVALID");
        const types = [...new Set(input.types)].sort();
        if (types.length !== input.types.length) throw new Refused("TYPES_REPEATED");
        if (types.length === 0) throw new Refused("TYPES_EMPTY");
        // The role and the policy come first, as in chooseAudiencePlace: someone who may not do this learns nothing of the places.
        mustAuthor(standing, actor.staffId, { types, audience: askedFor(input.place, { groups: [], types }) });
        const resolved = await resolvePlace(tx, places, input.place, { groups: [], types });
        if (!resolved.ok) throw new Refused(resolved.error);
        const content: EntryContent = {
          text: input.textFor(resolved.value),
          types,
          audience: resolved.value,
          phase: input.phase ?? "problem",
          validUntil: input.validUntil ?? new Date(createdAt.getTime() + UNTIL_RESOLVED_MS),
          // The draft starts "until resolved" unless a time was given.
          validUntilMode: input.validUntil ? "at" : "resolved",
        };
        const invalid = contentRefusal(content) ?? validUntilProblem(content.validUntil, createdAt);
        if (invalid) throw new Refused(invalid);
        mustAuthor(standing, actor.staffId, content);
        return insertThread(tx, actor, { kind: input.kind, isDrill: input.isDrill, reportedAt: input.reportedAt, content }, { alertId, entryId, createdAt });
      });
    },

    /**
     * Adds an update to a running thread (S05.01, "Add an update" O-14 and "Promote to full alert" O-13, which is the first update): a new draft of kind
     * `update` that starts from the thread, in one transaction under its lock, and then goes through submit, approval, translation and freezing exactly like
     * any entry (nothing here forks them: `beginSubmit` and `approveEntry` do not know it is an update). The thread's types and audience are carried over
     * from the entry that covers it (the latest published, non-superseded substantive entry); the phase and the valid-until are the author's, the text is
     * what they wrote. The audience changes only through the pickers afterwards (a widening or narrowing is stored on the update and shown to the approver).
     * An update supersedes nothing: no earlier entry changes, and nothing queued is cancelled.
     *
     * Refused: a thread that is closed (`ALERT_CLOSED`, "This alert is already closed"), one with nothing residents can read yet (`NO_PUBLISHED_ENTRY`: its
     * first entry waits for approval), a role or buildings the author may not write for (the policy, as for any draft), and everything a draft's content
     * must satisfy: the text, the phase (`PHASE_INVALID`: it is required), the valid-until. Audited as `entry.created`. A request that names an entry id this
     * person already made in this thread returns that entry and changes nothing (the same press, sent twice).
     */
    async addUpdate(actor: AlertActor, ref: { alertId: string }, input: AddUpdateInput): Promise<AlertResult<{ thread: ThreadView; entry: EntryView }>> {
      return change("entry.created", actor, { type: "alert_entry", id: input.entryId }, async (tx) => {
        // AD-18: the thread is locked first, and a closed one refuses here whatever follows.
        const { thread, standing } = await open(tx, actor, { alertId: ref.alertId });
        if (!UUID.test(input.entryId)) throw new Refused("ENTRY_ID_INVALID");
        const [existing] = await tx.select().from(alertEntry).where(eq(alertEntry.id, input.entryId)).for("update");
        if (existing) {
          if (existing.alertId === thread.id && existing.authorId === actor.staffId && existing.kind === "update") return { thread: threadOf(thread), entry: entryOf(existing) };
          throw new Refused("ENTRY_ID_INVALID");
        }
        const at = now();
        const covering = coveringEntry(publishedSummaries(await tx.select().from(alertEntry).where(eq(alertEntry.alertId, thread.id))));
        if (covering === null) throw new Refused("NO_PUBLISHED_ENTRY");
        const start = updateStart(covering, at);
        const content: EntryContent = { text: input.text, types: start.types, audience: start.audience, phase: input.phase, validUntil: input.validUntil, validUntilMode: input.validUntilMode };
        mustAuthor(standing, actor.staffId, content);
        const invalid = contentRefusal(content) ?? validUntilProblem(content.validUntil, at);
        if (invalid) throw new Refused(invalid);
        // The places the carried-over audience names are not checked here: a floor removed since the covering entry was approved must not stop the author from
        // starting an update, whose pickers are the way to choose another place. Submit and approval check the places, as they do for every entry.
        const row = await insertEntry(tx, actor, { alertId: thread.id, entryId: input.entryId, createdAt: at }, "update", content);
        await audit.record(tx, {
          action: "entry.created",
          actorStaffId: actor.staffId,
          subjectType: "alert_entry",
          subjectId: row.id,
          isDrill: thread.isDrill,
          meta: { entry_id: row.id, kind: "update", types: [...content.types] },
        });
        return { thread: threadOf(thread), entry: entryOf(row) };
      });
    },

    /**
     * An ambassador's post (A-02, S08.02): makes the draft the ambassador's screen submits next, in one transaction under the thread's lock, either as a new
     * thread's first entry (an `update`: they say what is happening, the Hub's acknowledgement step is the Hub's) or as an `update` to an open thread (`into`:
     * an alert about their building, or a drill, where it is a practice post). It is for exactly one building, one they are assigned to now (the policy's
     * `alert.author`, `assigned_building`), with its floors as a range, a list or the whole building, and for the types an Ambassador may post (heat, smoke and
     * winter storm are neighbourhood alerts: `NOT_ALLOWED`); an update keeps its thread's types. No groups: everyone in the place.
     *
     * The ids are the page's: a request that names this person's own post again changes nothing when it was submitted already (the same press, sent again),
     * and when it is still a draft (a press whose submit failed, pressed again) the draft takes what was sent now. An id that is someone else's, or another
     * thread's, is refused (`ENTRY_ID_INVALID`). Only an Ambassador posts here (`NOT_ALLOWED` for anyone else: the Hub writes on its own screens). Audited as
     * `alert.created` for a new thread and `entry.created` for an update; the submit, translation, freeze and second-person approval that follow are E04's, unchanged.
     */
    async postFromAmbassador(actor: AlertActor, input: AmbassadorPostInput): Promise<AlertResult<{ thread: ThreadView; entry: EntryView }>> {
      // The same new post sent twice at once waits on the lock of the new thread's id (`postOnce`); should a press still lose a race on a primary key (the
      // entry's id), it is rolled back whole and runs once again, and then finds what the other made (the same press).
      try {
        return await postOnce(actor, input);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return postOnce(actor, input);
      }
    },


    /**
     * "Correct" (O-15, S05.02): makes a draft `correction` that names `ref.targetId`, in one transaction under the thread's lock. The target must be a valid
     * target (approved, or pending approval and web-published, not already replaced, not a withdrawal notice: TARGET_NOT_VALID, TARGET_SUPERSEDED,
     * TARGET_NOT_PUBLISHED), in an open thread (ALERT_CLOSED); the role policy (`alert.correct`) is asked against the target: an Ambassador corrects only their
     * own pending entry (S08.04: another's is `OUT_OF_SCOPE`), a Director never, and a Coordinator or an Admin may correct any valid target. The correction starts from what covers the
     * thread (the audience, the types, the valid-until choice), like an update; the phase is the author's and required. It goes on through the composer,
     * submit and a second person's approval like any entry; approving it replaces the target (`approveEntry`). Audited as `entry.created`. A request that names
     * an entry id this person already made as a correction of this target returns it and changes nothing.
     */
    async correctEntry(actor: AlertActor, ref: { alertId: string; targetId: string }, input: CorrectInput): Promise<AlertResult<{ thread: ThreadView; entry: EntryView }>> {
      return change("entry.created", actor, { type: "alert_entry", id: input.entryId }, async (tx) => {
        const { thread, standing } = await open(tx, actor, { alertId: ref.alertId });
        if (!UUID.test(input.entryId)) throw new Refused("ENTRY_ID_INVALID");
        const [existing] = await tx.select().from(alertEntry).where(eq(alertEntry.id, input.entryId)).for("update");
        if (existing) {
          if (existing.alertId === thread.id && existing.authorId === actor.staffId && existing.kind === "correction" && existing.supersedesId === ref.targetId) {
            return { thread: threadOf(thread), entry: entryOf(existing) };
          }
          throw new Refused("ENTRY_ID_INVALID");
        }
        const target = await lockedTarget(tx, thread, standing, actor, ref.targetId, "alert.correct");
        const at = now();
        const rows = await tx.select().from(alertEntry).where(eq(alertEntry.alertId, thread.id));
        const covering = coveringEntry(publishedSummaries(rows)) ?? publishedSummaries([target])[0];
        const start = updateStart(covering, at);
        // An Ambassador corrects their own post (S08.04), which is for their building: it keeps the post's own types and audience, whatever covers the thread now
        // (the Hub's wider entry may), so the correction is judged and attributed as the post was.
        const own = standing.role === "ambassador";
        const content: EntryContent = {
          text: input.text,
          types: own ? target.types : start.types,
          audience: own ? (target.audience as Audience) : start.audience,
          phase: input.phase,
          validUntil: input.validUntil,
          validUntilMode: input.validUntilMode,
        };
        mustAuthor(standing, actor.staffId, content);
        const invalid = contentRefusal(content) ?? validUntilProblem(content.validUntil, at);
        if (invalid) throw new Refused(invalid);
        const row = await insertEntry(tx, actor, { alertId: thread.id, entryId: input.entryId, createdAt: at }, "correction", content, { supersedesId: target.id });
        await audit.record(tx, {
          action: "entry.created",
          actorStaffId: actor.staffId,
          subjectType: "alert_entry",
          subjectId: row.id,
          isDrill: thread.isDrill,
          meta: { entry_id: row.id, kind: "correction", types: [...content.types] },
        });
        return { thread: threadOf(thread), entry: entryOf(row) };
      });
    },

    /**
     * "Withdraw" (O-15, S05.02): makes a draft `withdrawal` that names `ref.targetId` with a reason from the catalog (wrong place, wrong information, duplicate,
     * other: WITHDRAWAL_REASON_INVALID for anything else) and the notice residents read in the target's place (`input.text`: required, and for "other" the
     * words the Hub wrote). Judged like `correctEntry`: the thread's lock, a valid target, the role policy (`alert.withdraw`). The withdrawal is the target's in
     * everything else: its audience (who is told), its types, where things stood; its valid-until is 24 hours from now (it is not read as the thread's: a
     * withdrawal notice is never substantive). Audited as `entry.created`.
     */
    async withdrawEntry(actor: AlertActor, ref: { alertId: string; targetId: string }, input: WithdrawInput): Promise<AlertResult<{ thread: ThreadView; entry: EntryView }>> {
      return change("entry.created", actor, { type: "alert_entry", id: input.entryId }, async (tx) => {
        const { thread, standing } = await open(tx, actor, { alertId: ref.alertId });
        if (!UUID.test(input.entryId)) throw new Refused("ENTRY_ID_INVALID");
        const [existing] = await tx.select().from(alertEntry).where(eq(alertEntry.id, input.entryId)).for("update");
        if (existing) {
          if (existing.alertId === thread.id && existing.authorId === actor.staffId && existing.kind === "withdrawal" && existing.supersedesId === ref.targetId) {
            return { thread: threadOf(thread), entry: entryOf(existing) };
          }
          throw new Refused("ENTRY_ID_INVALID");
        }
        const target = await lockedTarget(tx, thread, standing, actor, ref.targetId, "alert.withdraw");
        if (!isWithdrawalReason(input.reason)) throw new Refused("WITHDRAWAL_REASON_INVALID");
        const at = now();
        const content: EntryContent = {
          text: input.text,
          types: target.types,
          audience: target.audience as Audience,
          phase: target.phase as Phase,
          validUntil: new Date(at.getTime() + UNTIL_RESOLVED_MS),
          validUntilMode: "resolved",
        };
        mustAuthor(standing, actor.staffId, content);
        const invalid = contentRefusal(content);
        if (invalid) throw new Refused(invalid);
        const row = await insertEntry(tx, actor, { alertId: thread.id, entryId: input.entryId, createdAt: at }, "withdrawal", content, { supersedesId: target.id, withdrawalReason: input.reason });
        await audit.record(tx, {
          action: "entry.created",
          actorStaffId: actor.staffId,
          subjectType: "alert_entry",
          subjectId: row.id,
          isDrill: thread.isDrill,
          meta: { entry_id: row.id, kind: "withdrawal", types: [...content.types] },
        });
        return { thread: threadOf(thread), entry: entryOf(row) };
      });
    },

    /**
     * "Mark resolved" (O-16, S05.03): makes a draft `final`, the last word of a running alert, in one transaction under the thread's lock. It starts from what
     * covers the thread (who it is for, the types, where things stood) and is the author's words; its valid-until is "until resolved", renewed by each save and by
     * the submit. It goes on through the composer, submit and a second person's approval like any entry; approving it closes the thread (`approveEntry`:
     * `closeAlert(alertId, 'resolved', keepEntryId = the final)`). The role policy is an update's (`alert.author_wide`, or `alert.author` for the buildings an
     * Ambassador is assigned to: the Ambassador's own screens are E08's). Refused: a thread that is closed (`ALERT_CLOSED`: a closed thread offers no
     * "Mark resolved"), one with nothing residents can read yet (`NO_PUBLISHED_ENTRY`), and what a draft's text must satisfy. Audited as `entry.created`. A request
     * that names an entry id this person already made as a final of this thread returns it and changes nothing (the same press, sent twice).
     */
    async startFinal(actor: AlertActor, ref: { alertId: string }, input: StartFinalInput): Promise<AlertResult<{ thread: ThreadView; entry: EntryView }>> {
      return change("entry.created", actor, { type: "alert_entry", id: input.entryId }, async (tx) => {
        const { thread, standing } = await open(tx, actor, { alertId: ref.alertId });
        if (!UUID.test(input.entryId)) throw new Refused("ENTRY_ID_INVALID");
        const [existing] = await tx.select().from(alertEntry).where(eq(alertEntry.id, input.entryId)).for("update");
        if (existing) {
          if (existing.alertId === thread.id && existing.authorId === actor.staffId && existing.kind === "final") return { thread: threadOf(thread), entry: entryOf(existing) };
          throw new Refused("ENTRY_ID_INVALID");
        }
        const at = now();
        const covering = coveringEntry(publishedSummaries(await tx.select().from(alertEntry).where(eq(alertEntry.alertId, thread.id))));
        if (covering === null) throw new Refused("NO_PUBLISHED_ENTRY");
        const content: EntryContent = {
          text: input.text,
          types: covering.types,
          audience: covering.audience,
          phase: covering.phase,
          validUntil: new Date(at.getTime() + UNTIL_RESOLVED_MS),
          validUntilMode: "resolved",
        };
        mustAuthor(standing, actor.staffId, content);
        const invalid = contentRefusal(content);
        if (invalid) throw new Refused(invalid);
        const row = await insertEntry(tx, actor, { alertId: thread.id, entryId: input.entryId, createdAt: at }, "final", content);
        await audit.record(tx, {
          action: "entry.created",
          actorStaffId: actor.staffId,
          subjectType: "alert_entry",
          subjectId: row.id,
          isDrill: thread.isDrill,
          meta: { entry_id: row.id, kind: "final", types: [...content.types] },
        });
        return { thread: threadOf(thread), entry: entryOf(row) };
      });
    },

    /**
     * Saves a draft's content. Whoever saves a change becomes an editor (the trigger adds them), so
     * they can no longer approve this entry. A draft only, in an open thread.
     */
    async saveDraft(actor: AlertActor, ref: EntryRef, content: EntryContent): Promise<AlertResult<EntryView>> {
      // Not audited, refusals included: the acceptance criteria audit transitions only (create, submit,
      // return, discard, approve), and a refused save changes nothing.
      return change(null, actor, { type: "alert_entry", id: ref.entryId }, async (tx) => {
        const { standing, entry } = await open(tx, actor, ref);
        return writeDraft(tx, standing, actor, entry!, content, { checkValidUntil: true });
      });
    },

    /**
     * The place picker (O-03, S04.04): sets who the draft is for by place, keeping its groups and types. The choice is
     * a whole neighbourhood, or buildings each with the whole building or floors (ticked, or a range from one floor to
     * another by the building's order); the use case turns it into the one Audience value (floors by floor id, sorted
     * and without repeats) inside this transaction, reading the buildings and floors through it. An empty selection, a
     * floor that is not in its building and a reversed range are refused, each with its reason; an Ambassador's choice
     * of a building they are not assigned to is refused like any other save (the role policy, AD-4).
     */
    async chooseAudiencePlace(actor: AlertActor, ref: EntryRef, choice: PlaceChoice): Promise<AlertResult<EntryView>> {
      return change(null, actor, { type: "alert_entry", id: ref.entryId }, async (tx) => {
        const { standing, entry } = await open(tx, actor, ref);
        const current = contentOf(entry!);
        // The role and the policy come first, for the draft as it is and for the scope and buildings asked for, so that
        // someone who may not do this learns nothing about which buildings, floors or neighbourhoods exist.
        mustAuthor(standing, actor.staffId, current);
        mustAuthor(standing, actor.staffId, { types: current.types, audience: askedFor(choice, { groups: current.audience.groups, types: current.types }) });
        const resolved = await resolvePlace(tx, places, choice, { groups: current.audience.groups, types: current.types });
        if (!resolved.ok) throw new Refused(resolved.error);
        return writeDraft(tx, standing, actor, entry!, { ...current, audience: resolved.value });
      });
    },

    /**
     * The group picker (O-04, S04.04): sets the groups of the draft's audience, keeping its place. Groups narrow who is
     * texted; every web reader still sees the alert. A group nobody offers is refused; none chosen is no narrowing.
     */
    async chooseAudienceGroups(actor: AlertActor, ref: EntryRef, groups: readonly string[]): Promise<AlertResult<EntryView>> {
      return change(null, actor, { type: "alert_entry", id: ref.entryId }, async (tx) => {
        const { standing, entry } = await open(tx, actor, ref);
        const current = contentOf(entry!);
        const resolved = resolveGroups(groups);
        if (!resolved.ok) throw new Refused(resolved.error);
        return writeDraft(tx, standing, actor, entry!, { ...current, audience: { ...current.audience, groups: resolved.value } });
      });
    },

    /**
     * Returns a pending entry to draft, keeping its text; clears the approval binding (hash, SMS bodies,
     * time) and the frozen translations. `edit`: someone who may author it pulls it back to change it,
     * and becomes an editor. `return`: an approver (not an editor, `aal2`) sends it back to its author,
     * and does not become one. Never for a web-published entry.
     */
    async returnEntry(
      actor: AlertActor,
      ref: EntryRef,
      reason: Exclude<ReturnReason, "retranslate">,
      options: ReviewAction & { note?: string } = {},
    ): Promise<AlertResult<EntryView>> {
      return change("entry.returned", actor, { type: "alert_entry", id: ref.entryId }, async (tx) => {
        const { thread, standing, entry } = await open(tx, actor, ref);
        if (reason === "return") mustMayApprove(standing, actor, entry!);
        else mustAuthor(standing, actor.staffId, contentOf(entry!));
        // The role comes first, so someone who may not do this learns nothing; then the entry is the one the approver was shown, and the note is there.
        mustMatchShown(entry!, options.shown);
        const note = reason === "return" ? noteOf(options.note) : null;
        return returnIn(tx, entry!, thread, actor, reason, note);
      });
    },

    /**
     * Discards a draft or a pending entry. A draft by an editor who may author it; a pending entry
     * also by an approver (not an editor). Never a web-published entry (it is withdrawn, E05).
     */
    async discardEntry(actor: AlertActor, ref: EntryRef, options: ReviewAction = {}): Promise<AlertResult<EntryView>> {
      return change("entry.discarded", actor, { type: "alert_entry", id: ref.entryId }, async (tx) => {
        const { thread, standing, entry } = await open(tx, actor, ref);
        // A pending entry that residents already read (D-1, S08.03) is not discarded: a system withdrawal takes its place (`discardPublishedIn`, below).
        const published = entry!.webPublishedAt !== null && entry!.status === "pending_approval";
        if (published) mustTransitionToSuperseded(thread, entry!);
        else mustTransition(thread, entry!, "discarded");
        if (entry!.editorIds.includes(actor.staffId)) mustAuthor(standing, actor.staffId, contentOf(entry!));
        else if (entry!.status === "pending_approval") mustMayApprove(standing, actor, entry!);
        else if (entry!.status === "draft" && options.shown !== undefined) {
          // An approver who read a pending entry that its author has pulled back since: the role still comes first, then they are told it changed.
          mustMayApprove(standing, actor, entry!);
        } else throw new Refused("OUT_OF_SCOPE");
        mustMatchShown(entry!, options.shown);
        const from = entry!.status as "draft" | "pending_approval";
        if (published) return discardPublishedIn(tx, entry!, thread, actor);
        // Why (S08.02): the author taking back their own entry, or anyone else (an approver, or the Hub having edited it) not sending it: only the second is
        // "Not sent by the Hub" on an ambassador's screens.
        const discardReason = discardReasonOf(actor.staffId, entry!.authorId);
        const [discarded] = await tx.update(alertEntry).set({ status: "discarded", discardReason }).where(eq(alertEntry.id, entry!.id)).returning();
        await audit.record(tx, {
          action: "entry.discarded",
          actorStaffId: actor.staffId,
          subjectType: "alert_entry",
          subjectId: entry!.id,
          isDrill: thread.isDrill,
          meta: { entry_id: entry!.id, version: entry!.version, from, discard_reason: discardReason },
        });
        return entryOf(discarded);
      });
    },

    /**
     * Approves a pending entry exactly as the approver saw it (`shown`: the version, the hash and the number of people the text reaches).
     * Refused unless: the session is `aal2` (Admin and Coordinator), the policy lets this role approve, the approver is neither the
     * author nor an editor, the author may still author it now (active, and their current assignments cover the buildings), the version
     * and hash still match what was shown, and the valid-until is still ahead. Then, in this one transaction: the entry becomes
     * `approved` and web-published and `feed_version` goes up (a drill changes nothing the web shows, so it does not); the outbox's marker is
     * set (`markApprovalTransaction`); the people to text are captured through `captureRecipients(entry, tx)` and their alert deliveries are
     * written through `enqueueAlertDeliveries(tx, entryId, texts)`, each in the entry's frozen text message for the person's language; and if
     * the number of texts that returns is not what the approver reviewed (RECIPIENT_COUNT_CHANGED, carrying that count) everything rolls back,
     * the deliveries with it; else `entry.approved` is audited with the version, the hash and that recipient count. After it commits the
     * caller revalidates the feed's tag and kicks the dispatcher (src/app/staff/alerts/approval).
     *
     * The order is the lock order of AD-18: alert, alert_entry, feed_version, then the delivery rows and the recipient rows `captureRecipients` locks (with
     * them, in the same id-ordered statement, S08.06's requesters of the thread's round, for an acknowledgement, update or correction of a round type), then
     * the round's `checkin` and `checkin_tally`, then the spend cap.
     */
    async approveEntry(actor: AlertActor, ref: EntryRef, shown: ApprovalRequest): Promise<AlertResult<ApprovalOutcome>> {
      return change("entry.approved", actor, { type: "alert_entry", id: ref.entryId }, async (tx): Promise<ApprovalOutcome> => {
        const { thread, standing, entry } = await open(tx, actor, ref);
        const row = entry!;
        // An entry that can close the thread (a final, or a withdrawal that may leave nothing) locks every entry of the thread now, before `feed_version` and the
        // delivery rows, so the close that follows (`closeAlert` locks them again) is in the lock order of AD-18: alert, alert_entry, feed_version, delivery.
        if (row.kind === "final" || row.kind === "withdrawal") await tx.select({ id: alertEntry.id }).from(alertEntry).where(eq(alertEntry.alertId, thread.id)).orderBy(alertEntry.id).for("update");
        mustMayApprove(standing, actor, row);
        const refusal = checkApproval({
          approverId: actor.staffId,
          authorId: row.authorId,
          editorIds: row.editorIds,
          status: row.status as EntryStatus,
          version: row.version,
          contentHash: row.contentHash,
          shownVersion: shown.version,
          shownHash: shown.contentHash,
          validUntil: row.validUntil,
          now: now(),
        });
        if (refusal) throw new Refused(refusal);
        // The "Now also for" line was read against an entry that covers the thread; if another one covers it now, the line is out of date (S05.01).
        if (shown.covering !== undefined && ((await readThreadSummary(tx, ref.alertId))?.covering?.id ?? null) !== shown.covering) throw new Refused("ENTRY_CHANGED");
        mustTransition(thread, row, "approved");
        // AD-5: approval re-checks the author against their current status and assignments.
        const author = await staff.standing(tx, row.authorId);
        if (!author || author.status !== "active" || authoringRefusal(author, row.authorId, contentOf(row)) !== null) throw new Refused("AUTHOR_NOT_ALLOWED");
        // ... and the places it names are still there: a floor removed since the submit is not a floor to text. (A withdrawal goes to the people the withdrawn
        // entry went to: a floor removed since must not stop it.)
        if (row.kind !== "withdrawal") await mustExist(tx, contentOf(row).audience);
        // S06.07: once texting is live, a real alert is approved only if someone is on call to hear that sending is failing (a drill is not).
        // Staff engineer's decision: never a correction, a withdrawal or a final, which staff must always be able to publish to fix or take back wrong
        // information residents are reading, or to close an alert they are reading (S05.03); the target checks below are reported as themselves.
        if (!thread.isDrill && !isSupersedingKind(row.kind) && row.kind !== "final" && deps.oncall?.required() && !(await deps.oncall.hasNumber(tx))) throw new Refused("ONCALL_REQUIRED");
        // A correction or a withdrawal replaces the entry it names (S05.02): that entry is locked now (alert, then the approving entry, then the target; the
        // thread's lock already serializes every change to this thread) and judged again, because it may have been corrected or withdrawn since this was
        // submitted, and two corrections of one entry must not both go through.
        let target: EntryRow | null = null;
        if (isSupersedingKind(row.kind)) {
          if (row.supersedesId === null) throw new Refused("TARGET_NOT_VALID");
          [target] = await tx
            .select()
            .from(alertEntry)
            .where(and(eq(alertEntry.id, row.supersedesId), eq(alertEntry.alertId, thread.id)))
            .for("update");
          const targetProblem = targetRefusal(target ? targetFactsOf(target) : null);
          if (targetProblem) throw new Refused(targetProblem);
          mustTransition(thread, target, "superseded");
        }
        // `approved_at` and `web_published_at` are not sent: the entry trigger sets both to the database's now().
        const [approved] = await tx
          .update(alertEntry)
          .set({ status: "approved", approvedBy: actor.staffId, approvedVersion: row.version, approvedHash: row.contentHash })
          .where(eq(alertEntry.id, row.id))
          .returning();
        // The replaced entry becomes `superseded` in this same transaction, after the approval (the entry trigger accepts it only beside the approved
        // correction or withdrawal that names it) and audited with it.
        if (target !== null) {
          await tx.update(alertEntry).set({ status: "superseded" }).where(eq(alertEntry.id, target.id));
          await audit.record(tx, {
            action: "entry.superseded",
            actorStaffId: actor.staffId,
            subjectType: "alert_entry",
            subjectId: target.id,
            isDrill: thread.isDrill,
            meta: {
              entry_id: target.id,
              by: row.id,
              by_kind: row.kind as "correction" | "withdrawal",
              ...(row.withdrawalReason !== null ? { withdrawal_reason: row.withdrawalReason as WithdrawalReason } : {}),
            },
          });
        }
        let feedVersionNow: number | null = null;
        if (!thread.isDrill) {
          const bumped = await tx.update(feedVersion).set({ version: sql`${feedVersion.version} + 1` }).where(eq(feedVersion.id, 1)).returning({ version: feedVersion.version });
          if (bumped.length !== 1) throw new Error("alerting: feed_version has no row");
          feedVersionNow = Number(bumped[0].version);
        }
        // The replaced entry's texts that are not yet handed to the provider stop in this same transaction (messaging's `cancelQueued`, after `feed_version`:
        // the lock order of AD-18 is alert, alert_entry, feed_version, then delivery rows). Texts already handed over are in flight and cannot be stopped.
        if (target !== null) await cancelQueued(tx, [target.id]);
        // A final closes the thread `resolved` in this same transaction (S05.03), before its recipients are captured: `closeAlert` discards the drafts and the
        // entries waiting for approval, stops the queued texts of every other entry (the final's own are kept), records the final as the entry that closed the
        // thread and audits `alert.closed`. `feed_version` was raised above, so it is not raised twice. Its check-in round ends after the capture (below).
        if (row.kind === "final") await closeAlert(tx, actor, { alertId: thread.id, reason: "resolved", keepEntryId: row.id, feedRaised: true, roundEndedByCaller: true });
        // The outbox's marker (S06.01, `createDeliveryQueue().markApprovalTransaction`): this transaction says that the alert deliveries about to be
        // written are this entry's approval, so the database accepts them. Nothing is captured and nothing is written before it.
        await markApproval(tx, row.id);
        // S08.06: an acknowledgement, update or correction of a real thread starts its check-in round, or adds to it, when one of its types is a round
        // type. Its candidate requesters are read now, without a lock, so that the capture below locks their rows with the recipients' in its one
        // id-ordered statement (AD-18: in a second pass, a requester whose id is below a recipient's would be locked after it, and the campaign start's
        // `lockActive`, which takes every active subscriber in id order, could deadlock with this approval). A withdrawal or a final never starts a round,
        // nor a D-1 publication (made at submit, not here).
        const { types, audience } = contentOf(approved);
        const round: RoundStart | null = !thread.isDrill && ROUND_KINDS.has(row.kind) ? { alertId: thread.id, types, audience } : null;
        const requesters = deps.rounds && round ? await deps.rounds.requesters(tx, round) : [];
        // The snapshot, in this transaction (AD-7): who gets the text and in which language (`captureRecipients`), their texts queued through the
        // outbox (`enqueueAlertDeliveries`), and the number of texts it returns by language. What the approver reviewed is compared with that.
        const { counts: snapshot, costCents: entryCostCents } = await queueSnapshot(tx, { ...(await recipientEntryOf(tx, approved, thread)), alsoLock: requesters });
        const reviewed = shown.recipients ?? NO_RECIPIENTS;
        if (!sameRecipientCounts(reviewed, snapshot)) throw new Refused("RECIPIENT_COUNT_CHANGED", { recipients: snapshot, reviewed });
        await audit.record(tx, {
          action: "entry.approved",
          actorStaffId: actor.staffId,
          subjectType: "alert_entry",
          subjectId: row.id,
          isDrill: thread.isDrill,
          meta: { entry_id: row.id, version: approved.version, content_hash: row.contentHash!, recipient_count: snapshot.total },
        });
        // S08.06: the round itself. Each candidate whose "where I live" place matches the entry's audience, on a covered floor, gets one row (`ensureRound`,
        // ON CONFLICT DO NOTHING, reading each request under the lock the capture took), and the rows already made, with their marks, are left as they are
        // until the thread closes. After the texts and the audit, before the spend cap: AD-18's order (recipient rows, `checkin`, `checkin_tally`, `spend_cap`).
        if (deps.rounds && round && requesters.length > 0) await deps.rounds.start(tx, round, requesters);
        // S08.08: a final's thread closed above; its round ends here, after the capture locked the recipient rows (AD-18: recipient rows, `checkin`,
        // `checkin_tally`), where a round starts: checkins' `closeRound` tallies every row and keeps those the Hub must still follow up.
        if (row.kind === "final") await closeRound(tx, thread.id);
        // A withdrawal that leaves no published, non-superseded substantive entry closes the thread `withdrawn`, in this same transaction, even though the
        // withdrawal notice is itself published (it is never substantive): the notice's own texts are kept (`keepEntryId`) and every other entry's stop.
        if (target !== null && row.kind === "withdrawal") {
          const after = await tx.select().from(alertEntry).where(eq(alertEntry.alertId, thread.id));
          if (!substantiveRemains(after.map((entry) => ({ id: entry.id, kind: entry.kind as EntryKind, status: entry.status as EntryStatus, webPublishedAt: entry.webPublishedAt })), [target.id])) {
            await closeAlert(tx, actor, { alertId: thread.id, reason: "withdrawn", keepEntryId: row.id, feedRaised: true });
          }
        }
        // The monthly cap on text message spending (S07.08, AR-12) warns and never blocks: if this entry's texts take the month past it, the overrun is
        // audited here and recorded as an ops event (the health job texts the on-call Admins), in this same transaction, and the approval goes on. The
        // cap is the last row locked (AD-18), so it is taken after a withdrawal's own closing of the thread. Nothing is asked when no one is texted.
        if (deps.spendCap && snapshot.total > 0) {
          const overrun = await deps.spendCap(tx, { entryId: row.id, entryCostCents, now: now() });
          if (overrun) {
            await audit.record(tx, {
              action: "spend.cap_overrun",
              actorStaffId: actor.staffId,
              subjectType: "alert_entry",
              subjectId: row.id,
              isDrill: thread.isDrill,
              meta: { over_cents: overrun.overCents, cap_cents: overrun.capCents, entry_cents: entryCostCents },
            });
          }
        }
        return { entry: entryOf(approved), recipients: snapshot, feedVersion: feedVersionNow };
      });
    },

    /**
     * The record of an approval form that was refused before any use case ran, because it did not carry what its action needs (the entry's
     * version and hash, and for an approval the number of people the approver reviewed): a tampered or broken form. Every refusal is recorded
     * with its reason (S04.07), so this is `entry.approved`, `entry.returned` or `entry.discarded` as refused, with the reason `validation` and
     * the code `INVALID_FORM`, by the person, on the entry the form names. Nothing is read or changed besides the thread's drill flag.
     */
    async refuseInvalidForm(actor: AlertActor, form: InvalidFormAction, ref: EntryRef): Promise<void> {
      const [thread] = UUID.test(ref.alertId) ? await db.select({ isDrill: alert.isDrill }).from(alert).where(eq(alert.id, ref.alertId)) : [];
      await audit.recordRefusal(db, {
        action: INVALID_FORM_AUDIT_ACTION[form],
        actorStaffId: UUID.test(actor.staffId) ? actor.staffId : null,
        subjectType: "alert_entry",
        subjectId: UUID.test(ref.entryId) ? ref.entryId : null,
        isDrill: thread?.isDrill ?? false,
        meta: { reason: INVALID_FORM_REASON, refusal: INVALID_FORM_CODE },
      });
    },

    // Submit and "Try translation again" have one way in: beginSubmit, the preparation outside every lock, then completeSubmit (or
    // failSubmit), run by createSubmitter (submit.ts). There is no other use case that freezes an entry, so none can skip the attempt table,
    // the possible-duplicate check or the refusals of a translation that could not be made.
    beginSubmit,
    completeSubmit,
    failSubmit,

    /** Records one language's result on the running attempt, so a screen can show progress per language. A language that is not one, or an attempt that is not running, is ignored. */
    async recordProgress(ref: EntryRef, key: string, lang: string, status: string): Promise<void> {
      if (!(FROZEN_LANGS as readonly string[]).includes(lang) || !UUID.test(ref.entryId)) return;
      await db
        .update(alertSubmitAttempt)
        .set({ progress: sql`${alertSubmitAttempt.progress} || ${JSON.stringify({ [lang]: status })}::jsonb` })
        .where(and(eq(alertSubmitAttempt.entryId, ref.entryId), eq(alertSubmitAttempt.key, key), eq(alertSubmitAttempt.state, "running")));
    },

    /** Records the budget (milliseconds) the running attempt works to. */
    async recordBudget(ref: EntryRef, key: string, budgetMs: number): Promise<void> {
      if (!Number.isInteger(budgetMs) || budgetMs <= 0 || !UUID.test(ref.entryId)) return;
      await db
        .update(alertSubmitAttempt)
        .set({ budgetMs })
        .where(and(eq(alertSubmitAttempt.entryId, ref.entryId), eq(alertSubmitAttempt.key, key), eq(alertSubmitAttempt.state, "running")));
    },

    /**
     * One thread as residents have read it so far (S05.01): the entries they can read newest first, with each one's time and phase, the entry that covers
     * the thread and the valid-until it gives it, and whether the thread is still only an acknowledgement. Null when there is no such thread.
     */
    async threadSummary(alertId: string): Promise<ThreadSummary | null> {
      return readThreadSummary(db, alertId);
    },

    /** The threads that closed since `since`, newest first: the Hub home's "Recently closed" section. */
    async closedThreads(since: Date): Promise<ClosedThread[]> {
      return readClosedThreads(db, since);
    },

    /** The open threads residents have something substantive to read in, newest news first: what the Hub can add an update to (a closed thread is not here). */
    async runningThreads(): Promise<RunningThread[]> {
      return readRunningThreads(db);
    },

    /** One thread, as stored; null when there is none. */
    async getThread(alertId: string): Promise<ThreadView | null> {
      if (!UUID.test(alertId)) return null;
      const [row] = await db.select().from(alert).where(eq(alert.id, alertId));
      return row ? threadOf(row) : null;
    },

    /**
     * The entry's authoritative state, read in one snapshot (what a browser that lost the outcome of a submit, or returns to the
     * entry later, fetches): the thread, the entry as stored, the latest attempt (a `running` one older than the function's time
     * limit reads as failed) and, once there is one, the frozen translations. Null when there is no such entry.
     */
    async entryState(ref: EntryRef): Promise<EntryState | null> {
      if (!UUID.test(ref.alertId) || !UUID.test(ref.entryId)) return null;
      return db.transaction(
        async (tx) => {
          const [entryRow] = await tx.select().from(alertEntry).where(and(eq(alertEntry.id, ref.entryId), eq(alertEntry.alertId, ref.alertId)));
          const [threadRow] = await tx.select().from(alert).where(eq(alert.id, ref.alertId));
          if (!entryRow || !threadRow) return null;
          const [latest] = await tx.select().from(alertSubmitAttempt).where(eq(alertSubmitAttempt.entryId, ref.entryId)).orderBy(desc(alertSubmitAttempt.startedAt)).limit(1);
          const translations =
            entryRow.status === "draft" || entryRow.status === "discarded"
              ? []
              : await tx
                  .select({ lang: alertEntryTranslation.lang, status: alertEntryTranslation.status, machine: alertEntryTranslation.machine })
                  .from(alertEntryTranslation)
                  .where(eq(alertEntryTranslation.entryId, ref.entryId));
          // The entries made before this one that residents can read, oldest first: an entry that has some follows them (an update, S05.01). A draft or a
          // discarded update is not among them, so the composer an update is written on is the one `isAckOnly` (the Hub home, the start page) would choose.
          const earlier = await tx
            .select({ kind: alertEntry.kind, status: alertEntry.status, webPublishedAt: alertEntry.webPublishedAt })
            .from(alertEntry)
            .where(
              and(
                eq(alertEntry.alertId, ref.alertId),
                ne(alertEntry.id, entryRow.id),
                or(lt(alertEntry.createdAt, entryRow.createdAt), and(eq(alertEntry.createdAt, entryRow.createdAt), lt(alertEntry.id, entryRow.id))),
              ),
            )
            .orderBy(alertEntry.createdAt, alertEntry.id);
          return {
            thread: threadOf(threadRow),
            entry: entryOf(entryRow),
            attempt: latest ? attemptOf(latest, now()) : null,
            translations,
            priorKinds: earlier.filter(isPublished).map((row) => row.kind as EntryKind),
          };
        },
        { isolationLevel: "repeatable read" },
      );
    },

    /** One entry of a thread, as stored; null when there is none. */
    async getEntry(ref: EntryRef): Promise<EntryView | null> {
      if (!UUID.test(ref.alertId) || !UUID.test(ref.entryId)) return null;
      const [row] = await db
        .select()
        .from(alertEntry)
        .where(and(eq(alertEntry.id, ref.entryId), eq(alertEntry.alertId, ref.alertId)));
      return row ? entryOf(row) : null;
    },

    /**
     * What the approval view shows (O-05, O-07; S04.07), read in one repeatable-read snapshot: the thread, the entry as stored with its frozen web texts and
     * text messages, the author's role now, the possible duplicate and, for a pending entry, the number of people the text reaches as it stands now: the
     * reviewed count the approver's Approve then names. Null when there is no such entry.
     */
    async review(ref: EntryRef): Promise<EntryReview | null> {
      if (!UUID.test(ref.alertId) || !UUID.test(ref.entryId)) return null;
      return db.transaction(
        async (tx) => {
          const [entryRow] = await tx.select().from(alertEntry).where(and(eq(alertEntry.id, ref.entryId), eq(alertEntry.alertId, ref.alertId)));
          const [threadRow] = await tx.select().from(alert).where(eq(alert.id, ref.alertId));
          if (!entryRow || !threadRow) return null;
          const texts =
            entryRow.status === "draft" || entryRow.status === "discarded"
              ? []
              : await tx
                  .select({ lang: alertEntryTranslation.lang, body: alertEntryTranslation.body, status: alertEntryTranslation.status, machine: alertEntryTranslation.machine, model: alertEntryTranslation.model })
                  .from(alertEntryTranslation)
                  .where(eq(alertEntryTranslation.entryId, ref.entryId))
                  .orderBy(alertEntryTranslation.lang);
          const author = await staff.standing(tx, entryRow.authorId);
          const thread = threadOf(threadRow);
          const reached: RecipientCount =
            entryRow.status === "pending_approval" ? await recipients.count(await recipientEntryOf(tx, entryRow, threadRow), tx) : { open: false, ...NO_RECIPIENTS };
          let duplicate: EntryReview["duplicate"] = null;
          if (entryRow.possibleDuplicateOf) {
            const [other] = await tx
              .select({ id: alertEntry.id })
              .from(alertEntry)
              .where(and(eq(alertEntry.alertId, entryRow.possibleDuplicateOf), inArray(alertEntry.status, ["pending_approval", "approved"])))
              .orderBy(desc(alertEntry.createdAt))
              .limit(1);
            duplicate = { alertId: entryRow.possibleDuplicateOf, entryId: other?.id ?? null };
          }
          // An update that waits shows what it changes about who the thread is for: the audience of the entry that covers the thread now (S05.01).
          let threadAudience: Audience | null = null;
          let threadCoveringId: string | null = null;
          if (entryRow.status === "draft" || entryRow.status === "pending_approval") {
            const covering = (await readThreadSummary(tx, ref.alertId))?.covering ?? null;
            if (covering !== null && covering.id !== entryRow.id) {
              threadAudience = covering.audience;
              threadCoveringId = covering.id;
            }
          }
          // A correction or a withdrawal shows the entry it replaces, as residents read it now (S05.02).
          let target: EntryReview["target"] = null;
          // A final closes the thread when approved (S05.03): the approver is told before they approve.
          let closesThread = entryRow.kind === "final" && entryRow.status !== "approved" && entryRow.status !== "discarded";
          if (entryRow.supersedesId !== null) {
            const [replaced] = await tx.select().from(alertEntry).where(and(eq(alertEntry.id, entryRow.supersedesId), eq(alertEntry.alertId, ref.alertId)));
            if (replaced) {
              target = {
                id: replaced.id,
                kind: replaced.kind as EntryKind,
                status: replaced.status as EntryStatus,
                text: replaced.originalText,
                phase: replaced.phase as Phase,
                publishedAt: replaced.webPublishedAt,
                valid: targetRefusal(targetFactsOf(replaced)) === null,
                audience: replaced.audience as Audience,
              };
              // A withdrawal that leaves nothing substantive closes the thread: the approver is told before they approve.
              if (entryRow.kind === "withdrawal") {
                const all = await tx.select().from(alertEntry).where(eq(alertEntry.alertId, ref.alertId));
                closesThread = !substantiveRemains(all.map((row) => ({ id: row.id, kind: row.kind as EntryKind, status: row.status as EntryStatus, webPublishedAt: row.webPublishedAt })), [replaced.id]);
              }
            }
          }
          return {
            thread,
            entry: entryOf(entryRow),
            authorRole: author?.role ?? null,
            // A frozen entry is from whom its texts say (S08.02); a draft has no texts yet.
            attribution: entryRow.status === "draft" ? null : attributionOfRsn(entryRow.attributedRsn),
            texts,
            sms: (entryRow.smsBodies ?? {}) as Record<string, FrozenSmsBody>,
            recipients: reached,
            duplicate,
            threadAudience,
            threadCoveringId,
            target,
            closesThread,
          };
        },
        { isolationLevel: "repeatable read" },
      );
    },

    /**
     * What waits for a person and what they have in hand (S04.07's share of the Hub home; S04.10 builds the screen out). `waiting`: the pending
     * entries of open threads that a Coordinator or an Admin may approve (not one they edited), longest waiting first. `mine`: the open drafts and pending
     * entries the person is an editor of, newest first, with the note an approver wrote when they sent one back. Nothing is read for another role.
     */
    async incidents(actor: Pick<AlertActor, "staffId">): Promise<Incidents> {
      if (!UUID.test(actor.staffId)) return { waiting: [], mine: [] };
      const standing = await staff.standing(db, actor.staffId);
      if (!standing || standing.status !== "active") return { waiting: [], mine: [] };
      const columns = {
        alertId: alertEntry.alertId,
        entryId: alertEntry.id,
        kind: alertEntry.kind,
        status: alertEntry.status,
        types: alertEntry.types,
        isDrill: alert.isDrill,
        version: alertEntry.version,
        submittedAt: alertEntry.submittedAt,
        returnedNote: alertEntry.returnedNote,
        // Another entry was made before this one in its thread: an update (S05.01), written on the update composer.
        followUp: sql<boolean>`exists (select 1 from alert_entry earlier where earlier.alert_id = ${alertEntry.alertId} and earlier.id <> ${alertEntry.id} and earlier.web_published_at is not null and earlier.status not in ('draft', 'discarded') and (earlier.created_at, earlier.id) < (${alertEntry.createdAt}, ${alertEntry.id}))`,
      };
      const rowOf = (row: { alertId: string; entryId: string; kind: string; status: string; types: string[]; isDrill: boolean; version: number; submittedAt: Date | null; returnedNote: string | null; followUp: boolean }): IncidentRow => ({
        alertId: row.alertId,
        entryId: row.entryId,
        kind: row.kind as EntryKind,
        status: row.status as IncidentRow["status"],
        types: row.types,
        isDrill: row.isDrill,
        version: row.version,
        submittedAt: row.submittedAt,
        returnedNote: row.returnedNote,
        followUp: row.followUp === true,
      });
      const open = and(eq(alert.status, "open"), inArray(alertEntry.status, ["draft", "pending_approval"]));
      const mine = await db
        .select(columns)
        .from(alertEntry)
        .innerJoin(alert, eq(alert.id, alertEntry.alertId))
        .where(and(open, sql`${actor.staffId}::uuid = any (${alertEntry.editorIds})`))
        .orderBy(desc(alertEntry.updatedAt))
        .limit(100);
      const mayApprove = standing.role === "coordinator" || standing.role === "admin";
      const waiting = mayApprove
        ? await db
            .select(columns)
            .from(alertEntry)
            .innerJoin(alert, eq(alert.id, alertEntry.alertId))
            .where(and(eq(alert.status, "open"), eq(alertEntry.status, "pending_approval"), sql`not (${actor.staffId}::uuid = any (${alertEntry.editorIds}))`))
            .orderBy(alertEntry.submittedAt)
            .limit(100)
        : [];
      return { waiting: waiting.map(rowOf), mine: mine.map(rowOf) };
    },
  };
}

export type AlertLifecycle = ReturnType<typeof createAlertLifecycle>;
