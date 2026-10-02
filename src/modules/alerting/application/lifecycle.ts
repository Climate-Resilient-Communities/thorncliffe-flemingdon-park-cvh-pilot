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
import { and, eq, sql } from "drizzle-orm";
import { decidePolicy, meetsAssurance } from "../../identity";
import type { Db, DbTransaction } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import { alert, alertEntry, alertEntryTranslation, feedVersion } from "../adapters/schema";
import { audienceBuildings, contentRefusal, isWideContent, sameContent, validUntilRefusal, type AudienceValue, type EntryContent, type Phase } from "../domain/content";
import { AUTHORED_KINDS, checkApproval, requestTransition, type EntryKind, type EntryStatus, type ReturnReason } from "../domain/lifecycle";
import type { AlertRefusal } from "../domain/refusals";
import type { AlertActor, AlertAudit, AlertResult, EntryPreparer, FrozenContent, StaffDirectory } from "./ports";
import { AUDIT_REASON } from "./refusalReasons";
import type { StaffStanding } from "../../identity";

export interface AlertLifecycleDeps {
  db: Db;
  audit: AlertAudit;
  staff: StaffDirectory;
  now?: () => Date;
  newId?: () => string;
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
}

export interface ThreadView {
  id: string;
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

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
});

const contentOf = (row: EntryRow): EntryContent => ({
  text: row.originalText,
  types: row.types,
  audience: row.audience as AudienceValue,
  phase: row.phase as Phase,
  validUntil: row.validUntil,
});

const threadOf = (row: ThreadRow): ThreadView => ({ id: row.id, isDrill: row.isDrill, reportedAt: row.reportedAt, status: row.status as "open" | "closed" });

type AuditedAction = "alert.created" | "entry.submitted" | "entry.returned" | "entry.discarded" | "entry.approved";

export function createAlertLifecycle(deps: AlertLifecycleDeps) {
  const { db, audit, staff } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => uuidv7());
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

  /** Whether the transition is allowed by lifecycle.ts for this thread and entry. */
  function mustTransition(thread: ThreadRow, entry: EntryRow, to: EntryStatus) {
    const decision = requestTransition({ from: entry.status as EntryStatus, to, webPublished: entry.webPublishedAt !== null, threadOpen: thread.status === "open" });
    if (!decision.ok) throw new Refused(decision.refusal);
  }

  /** Only an editor (the author or someone who changed the entry) acts on its draft or pulls its submit back. */
  const mustBeEditor = (entry: EntryRow, staffId: string) => {
    if (!entry.editorIds.includes(staffId)) throw new Refused("OUT_OF_SCOPE");
  };

  async function submitIn(tx: DbTransaction, entry: EntryRow, thread: ThreadRow, actor: AlertActor, frozen: FrozenContent, expected?: EntryContent): Promise<EntryView> {
    mustTransition(thread, entry, "pending_approval");
    const content = contentOf(entry);
    if (expected && !sameContent(expected, content)) throw new Refused("DRAFT_CHANGED");
    const invalid = contentRefusal(content) ?? validUntilRefusal(content.validUntil, now());
    if (invalid) throw new Refused(invalid);
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
      .set({ status: "draft", returnedFor: reason, contentHash: null, smsBodies: null, submittedAt: null })
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
        const invalid = contentRefusal(input.content) ?? validUntilRefusal(input.content.validUntil, createdAt);
        if (invalid) throw new Refused(invalid);
        mustAuthor(standing, actor.staffId, input.content);
        await tx.execute(sql`select set_config('cvh.actor_id', ${actor.staffId}, true)`);
        const [thread] = await tx
          .insert(alert)
          .values({ id: alertId, isDrill: input.isDrill, reportedAt: input.reportedAt, createdBy: actor.staffId })
          .returning();
        const [entry] = await tx
          .insert(alertEntry)
          .values({
            id: entryId,
            alertId,
            kind: input.kind,
            authorId: actor.staffId,
            editorIds: [actor.staffId],
            originalText: input.content.text,
            types: [...input.content.types],
            audience: input.content.audience,
            phase: input.content.phase,
            validUntil: input.content.validUntil,
            createdAt,
          })
          .returning();
        await audit.record(tx, {
          action: "alert.created",
          actorStaffId: actor.staffId,
          subjectType: "alert",
          subjectId: alertId,
          isDrill: input.isDrill,
          meta: { entry_id: entryId, kind: input.kind, types: [...input.content.types] },
        });
        return { thread: threadOf(thread), entry: entryOf(entry) };
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
        if (entry!.status !== "draft") throw new Refused("ILLEGAL_TRANSITION");
        const invalid = contentRefusal(content);
        if (invalid) throw new Refused(invalid);
        mustAuthor(standing, actor.staffId, content);
        const [saved] = await tx
          .update(alertEntry)
          .set({ originalText: content.text, types: [...content.types], audience: content.audience, phase: content.phase, validUntil: content.validUntil })
          .where(eq(alertEntry.id, entry!.id))
          .returning();
        return entryOf(saved);
      });
    },

    /**
     * Submit: freezes the prepared content (translated, rendered and hashed outside any lock, by the
     * caller) and moves the draft to `pending_approval` as the next version. `expected` is the
     * content the preparation was made from; a draft that changed since is refused (DRAFT_CHANGED)
     * and nothing is frozen.
     */
    async submitEntry(actor: AlertActor, ref: EntryRef, frozen: FrozenContent, expected?: EntryContent): Promise<AlertResult<EntryView>> {
      return change("entry.submitted", actor, { type: "alert_entry", id: ref.entryId }, async (tx) => {
        const { thread, standing, entry } = await open(tx, actor, ref);
        mustBeEditor(entry!, actor.staffId);
        mustAuthor(standing, actor.staffId, contentOf(entry!));
        return submitIn(tx, entry!, thread, actor, frozen, expected);
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

    /**
     * "Try translation again" on a pending entry. In one short transaction it returns the entry to
     * draft (the caller names the version and hash it was looking at, so a changed entry is refused),
     * adding the person to `editor_ids`: they can no longer approve it. Then, outside any lock, it
     * re-translates, renders and hashes the draft through `preparer`. Then, in a second short
     * transaction, it re-submits as the next version with the new hash, refusing if the draft changed
     * meanwhile. If preparing fails the entry stays a draft (the person an editor) and Submit is
     * still there.
     */
    async retryTranslation(actor: AlertActor, ref: EntryRef, seen: ApprovalBinding, preparer: EntryPreparer): Promise<AlertResult<EntryView>> {
      const returned = await change("entry.returned", actor, { type: "alert_entry", id: ref.entryId }, async (tx) => {
        const { thread, standing, entry } = await open(tx, actor, ref);
        const row = entry!;
        if (row.status !== "pending_approval") throw new Refused("ENTRY_NOT_PENDING");
        if (row.version !== seen.version || row.contentHash !== seen.contentHash) throw new Refused("ENTRY_CHANGED");
        mustAuthor(standing, actor.staffId, contentOf(row));
        return { view: await returnIn(tx, row, thread, actor, "retranslate"), isDrill: thread.isDrill };
      });
      if (!returned.ok) return returned;
      const draft = returned.value.view;
      let frozen: FrozenContent;
      try {
        frozen = await preparer.prepare(draft.content, { alertId: ref.alertId, entryId: ref.entryId, isDrill: returned.value.isDrill });
      } catch {
        await audit.recordRefusal(db, {
          action: "entry.submitted",
          actorStaffId: actor.staffId,
          subjectType: "alert_entry",
          subjectId: ref.entryId,
          isDrill: returned.value.isDrill,
          meta: { reason: AUDIT_REASON.PREPARATION_FAILED },
        });
        return { ok: false, error: "PREPARATION_FAILED" };
      }
      return change("entry.submitted", actor, { type: "alert_entry", id: ref.entryId }, async (tx) => {
        const { thread, standing, entry } = await open(tx, actor, ref);
        mustBeEditor(entry!, actor.staffId);
        mustAuthor(standing, actor.staffId, contentOf(entry!));
        return submitIn(tx, entry!, thread, actor, frozen, draft.content);
      });
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
