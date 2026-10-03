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
import { decidePolicy, meetsAssurance } from "../../identity";
import type { Db, DbTransaction } from "../../../platform/db";
import { addTorontoDays } from "../../../platform/clock";
import { uuidv7 } from "../../../platform/ids";
import { alert, alertEntry, alertEntryTranslation, alertSubmitAttempt, feedVersion } from "../adapters/schema";
import { audienceRsns, type Audience } from "../../../contracts/audience";
import { UNTIL_RESOLVED_MS, VALID_UNTIL_MAX_DAYS, audienceBuildings, contentRefusal, draftFingerprint, isWideContent, sameContent, validUntilRefusal, type EntryContent, type Phase, type ValidUntilMode } from "../domain/content";
import { possibleDuplicateOf } from "../domain/duplicates";
import { AUTHORED_KINDS, checkApproval, requestTransition, type EntryKind, type EntryStatus, type ReturnReason } from "../domain/lifecycle";
import type { AlertRefusal } from "../domain/refusals";
import { ENTRY_CHANNELS, SUBMIT_KEY_PATTERN, isStaleAttempt, type AttemptKind, type AttemptState } from "../domain/submitAttempt";
import { FROZEN_LANGS } from "../domain/translations";
import { placeRefusal, resolveGroups, resolvePlace, type AudiencePlaces, type PlaceChoice } from "./audience";
import type { AlertActor, AlertAudit, AlertResult, FrozenContent, PrepareContext, StaffDirectory } from "./ports";
import { AUDIT_REASON } from "./refusalReasons";
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
  approvedBy: string | null;
  approvedAt: Date | null;
  webPublishedAt: Date | null;
  /** The open, non-drill thread this entry may duplicate, worked out at submit (S04.05); the approver is shown a link to it. */
  possibleDuplicateOf: string | null;
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

/** Found inside a transaction: nothing was written, and the refusal is audited after the rollback. */
class Refused extends Error {
  constructor(readonly refusal: AlertRefusal) {
    super(refusal);
  }
}

/** The refusals a trigger's message maps to: the race the use case's own checks lost. */
const TRIGGER_MESSAGES: readonly [RegExp, AlertRefusal][] = [
  [/ALERT_CLOSED/, "ALERT_CLOSED"],
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
  approvedBy: row.approvedBy,
  approvedAt: row.approvedAt,
  webPublishedAt: row.webPublishedAt,
  possibleDuplicateOf: row.possibleDuplicateOf,
});

const contentOf = (row: EntryRow): EntryContent => ({
  text: row.originalText,
  types: row.types,
  audience: row.audience as Audience,
  phase: row.phase as Phase,
  validUntil: row.validUntil,
  validUntilMode: row.validUntilMode as ValidUntilMode,
});

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

type AuditedAction = "alert.created" | "entry.submitted" | "entry.returned" | "entry.discarded" | "entry.approved";

export function createAlertLifecycle(deps: AlertLifecycleDeps) {
  const { db, audit, staff, places } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => uuidv7());
  const newSlug = deps.newSlug ?? randomSlug;
  const latestValidUntil = deps.latestValidUntil ?? ((at: Date) => addTorontoDays(at, VALID_UNTIL_MAX_DAYS));
  /** The valid-until rule at this moment: in the future, and no later than 7 Toronto days ahead. */
  const validUntilProblem = (validUntil: Date, at: Date) => validUntilRefusal(validUntil, at, latestValidUntil(at));
  /** The `is_drill` of the thread a transaction has read, for the record of a refusal that rolls it back. */
  const drillOf = new WeakMap<DbTransaction, boolean>();

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
    }
    if (action === null) return { ok: false, error: refusal };
    await audit.recordRefusal(db, {
      action,
      actorStaffId: UUID.test(actor.staffId) ? actor.staffId : null,
      subjectType: subject.type,
      subjectId: UUID.test(subject.id) ? subject.id : null,
      isDrill,
      meta: { reason: AUDIT_REASON[refusal] },
    });
    return { ok: false, error: refusal };
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
    // Saving the composer's draft judges the time the author entered (in the future, at most 7 days ahead); the audience
    // pickers change who it is for and not when it ends, so they leave a time that has since passed to the submit's own check.
    const invalid = contentRefusal(content) ?? (options.checkValidUntil ? validUntilProblem(content.validUntil, now()) : null);
    if (invalid) throw new Refused(invalid);
    // Changing a draft is authoring it: the actor must be allowed to author what it holds now (an Ambassador cannot take
    // over a Coordinator's neighbourhood draft, or a draft for a building they are not assigned to, by re-aiming it
    // at one they are), and what it will hold.
    mustAuthor(standing, actor.staffId, contentOf(entry));
    mustAuthor(standing, actor.staffId, content);
    await mustExist(tx, content.audience);
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

  /** Only an editor (the author or someone who changed the entry) acts on its draft or pulls its submit back. */
  const mustBeEditor = (entry: EntryRow, staffId: string) => {
    if (!entry.editorIds.includes(staffId)) throw new Refused("OUT_OF_SCOPE");
  };

  async function submitIn(
    tx: DbTransaction,
    entry: EntryRow,
    thread: ThreadRow,
    actor: AlertActor,
    frozen: FrozenContent,
    expected: EntryContent,
    duplicateOf: string | null,
  ): Promise<EntryView> {
    mustTransition(thread, entry, "pending_approval");
    const content = contentOf(entry);
    if (!sameContent(expected, content)) throw new Refused("DRAFT_CHANGED");
    const invalid = contentRefusal(content) ?? validUntilProblem(content.validUntil, now());
    if (invalid) throw new Refused(invalid);
    await mustExist(tx, content.audience);
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
        possibleDuplicateOf: duplicateOf,
      })
      .where(eq(alertEntry.id, entry.id))
      .returning();
    await audit.record(tx, {
      action: "entry.submitted",
      actorStaffId: actor.staffId,
      subjectType: "alert_entry",
      subjectId: entry.id,
      isDrill: thread.isDrill,
      meta: { entry_id: entry.id, version: submitted.version, content_hash: frozen.contentHash },
    });
    return entryOf(submitted);
  }

  async function returnIn(tx: DbTransaction, entry: EntryRow, thread: ThreadRow, actor: AlertActor, reason: ReturnReason): Promise<EntryView> {
    mustTransition(thread, entry, "draft");
    const [returned] = await tx
      .update(alertEntry)
      .set({ status: "draft", returnedFor: reason, contentHash: null, smsBodies: null, submittedAt: null, possibleDuplicateOf: null })
      .where(eq(alertEntry.id, entry.id))
      .returning();
    await audit.record(tx, {
      action: "entry.returned",
      actorStaffId: actor.staffId,
      subjectType: "alert_entry",
      subjectId: entry.id,
      isDrill: thread.isDrill,
      meta: { entry_id: entry.id, version: entry.version, returned_for: reason },
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
    const [entry] = await tx
      .insert(alertEntry)
      .values({
        id: ids.entryId,
        alertId: ids.alertId,
        kind: input.kind,
        authorId: actor.staffId,
        editorIds: [actor.staffId],
        originalText: input.content.text,
        types: [...input.content.types],
        audience: input.content.audience,
        phase: input.content.phase,
        validUntil: input.content.validUntil,
        validUntilMode: input.content.validUntilMode ?? "at",
        createdAt: ids.createdAt,
      })
      .returning();
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
      // TODO(E08): an Ambassador's post is attributed to their building ("Building ambassador, {building}") and is not yet
      // verified (D-1); this epic's texts say "from the Hub", "Verified by the Hub", so only Hub staff submit through here.
      if (standing.role === "ambassador") throw new Refused("NOT_ALLOWED");
      let content: EntryContent;
      if (mode.kind === "submit") {
        mustBeEditor(row, actor.staffId);
        mustAuthor(standing, actor.staffId, contentOf(row));
        mustTransition(thread, row, "pending_approval");
        content = contentOf(row);
        // The draft the author saved and saw is the draft that is submitted: someone else saving in between is refused, nothing frozen.
        if (mode.draft !== undefined && mode.draft !== draftFingerprint(content)) throw new Refused("DRAFT_CHANGED");
      } else {
        if (row.status !== "pending_approval") throw new Refused("ENTRY_NOT_PENDING");
        if (row.version !== mode.seen.version || row.contentHash !== mode.seen.contentHash) throw new Refused("ENTRY_CHANGED");
        mustAuthor(standing, actor.staffId, contentOf(row));
        content = (await returnIn(tx, row, thread, actor, "retranslate")).content;
      }
      const invalid = contentRefusal(content) ?? validUntilProblem(content.validUntil, at);
      if (invalid) throw new Refused(invalid);
      await mustExist(tx, content.audience);
      const duplicateOf = await findPossibleDuplicate(tx, thread, row, content);
      const slug = thread.slug;
      if (slug === null) throw new Error("alerting: a thread has no slug");
      const [created] = await tx.insert(alertSubmitAttempt).values({ entryId: row.id, key, kind: mode.kind, actorId: actor.staffId }).returning();
      const context: PrepareContext = {
        alertId: thread.id,
        entryId: row.id,
        isDrill: thread.isDrill,
        kind: row.kind as EntryKind,
        supersedesId: null,
        channels: ENTRY_CHANNELS,
        slug,
        verified: true,
        attribution: { role: "hub" },
      };
      return { kind: "started", attempt: attemptOf(created, at), expected: content, context, possibleDuplicateOf: duplicateOf };
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
  async function completeSubmit(actor: AlertActor, ref: EntryRef, key: string, frozen: FrozenContent, expected: EntryContent, duplicateOf: string | null): Promise<AlertResult<EntryView>> {
    const done = await change("entry.submitted", actor, { type: "alert_entry", id: ref.entryId }, async (tx) => {
      const { thread, standing, entry } = await open(tx, actor, ref);
      const [attempt] = await tx.select().from(alertSubmitAttempt).where(and(eq(alertSubmitAttempt.entryId, ref.entryId), eq(alertSubmitAttempt.key, key))).for("update");
      if (!attempt || attempt.actorId !== actor.staffId || attempt.state !== "running") throw new Refused("SUBMIT_ABANDONED");
      mustBeEditor(entry!, actor.staffId);
      mustAuthor(standing, actor.staffId, contentOf(entry!));
      const view = await submitIn(tx, entry!, thread, actor, frozen, expected, duplicateOf);
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
      meta: { reason: AUDIT_REASON[outcome] },
    });
    return true;
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
    async returnEntry(actor: AlertActor, ref: EntryRef, reason: Exclude<ReturnReason, "retranslate">): Promise<AlertResult<EntryView>> {
      return change("entry.returned", actor, { type: "alert_entry", id: ref.entryId }, async (tx) => {
        const { thread, standing, entry } = await open(tx, actor, ref);
        if (reason === "return") mustMayApprove(standing, actor, entry!);
        else mustAuthor(standing, actor.staffId, contentOf(entry!));
        return returnIn(tx, entry!, thread, actor, reason);
      });
    },

    /**
     * Discards a draft or a pending entry. A draft by an editor who may author it; a pending entry
     * also by an approver (not an editor). Never a web-published entry (it is withdrawn, E05).
     */
    async discardEntry(actor: AlertActor, ref: EntryRef): Promise<AlertResult<EntryView>> {
      return change("entry.discarded", actor, { type: "alert_entry", id: ref.entryId }, async (tx) => {
        const { thread, standing, entry } = await open(tx, actor, ref);
        mustTransition(thread, entry!, "discarded");
        if (entry!.editorIds.includes(actor.staffId)) mustAuthor(standing, actor.staffId, contentOf(entry!));
        else if (entry!.status === "pending_approval") mustMayApprove(standing, actor, entry!);
        else throw new Refused("OUT_OF_SCOPE");
        const from = entry!.status as "draft" | "pending_approval";
        const [discarded] = await tx.update(alertEntry).set({ status: "discarded" }).where(eq(alertEntry.id, entry!.id)).returning();
        await audit.record(tx, {
          action: "entry.discarded",
          actorStaffId: actor.staffId,
          subjectType: "alert_entry",
          subjectId: entry!.id,
          isDrill: thread.isDrill,
          meta: { entry_id: entry!.id, version: entry!.version, from },
        });
        return entryOf(discarded);
      });
    },

    /**
     * Approves a pending entry exactly as the approver saw it (`shown`). Refused unless: the session is
     * `aal2` (Admin and Coordinator), the policy lets this role approve, the approver is neither the
     * author nor an editor, the author may still author it now (active, and their current assignments
     * cover the buildings), the version and hash still match what was shown, and the valid-until is
     * still ahead. Then the entry becomes `approved` and web-published and `feed_version` goes up
     * (a drill changes nothing the web shows, so it does not), all in this transaction.
     */
    async approveEntry(actor: AlertActor, ref: EntryRef, shown: ApprovalBinding): Promise<AlertResult<EntryView>> {
      return change("entry.approved", actor, { type: "alert_entry", id: ref.entryId }, async (tx) => {
        const { thread, standing, entry } = await open(tx, actor, ref);
        const row = entry!;
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
        mustTransition(thread, row, "approved");
        // AD-5: approval re-checks the author against their current status and assignments.
        const author = await staff.standing(tx, row.authorId);
        if (!author || author.status !== "active" || authoringRefusal(author, row.authorId, contentOf(row)) !== null) throw new Refused("AUTHOR_NOT_ALLOWED");
        // ... and the places it names are still there: a floor removed since the submit is not a floor to text.
        await mustExist(tx, contentOf(row).audience);
        // `approved_at` and `web_published_at` are not sent: the entry trigger sets both to the database's now().
        const [approved] = await tx
          .update(alertEntry)
          .set({ status: "approved", approvedBy: actor.staffId, approvedVersion: row.version, approvedHash: row.contentHash })
          .where(eq(alertEntry.id, row.id))
          .returning();
        if (!thread.isDrill) {
          const bumped = await tx.update(feedVersion).set({ version: sql`${feedVersion.version} + 1` }).where(eq(feedVersion.id, 1)).returning({ version: feedVersion.version });
          if (bumped.length !== 1) throw new Error("alerting: feed_version has no row");
        }
        await audit.record(tx, {
          action: "entry.approved",
          actorStaffId: actor.staffId,
          subjectType: "alert_entry",
          subjectId: row.id,
          isDrill: thread.isDrill,
          meta: { entry_id: row.id, version: approved.version, content_hash: row.contentHash! },
        });
        return entryOf(approved);
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
          return { thread: threadOf(threadRow), entry: entryOf(entryRow), attempt: latest ? attemptOf(latest, now()) : null, translations };
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
  };
}

export type AlertLifecycle = ReturnType<typeof createAlertLifecycle>;
