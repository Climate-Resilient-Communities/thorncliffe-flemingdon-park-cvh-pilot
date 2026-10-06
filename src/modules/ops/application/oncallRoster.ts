// The on-call roster (S06.07, AD-13, AR-12, AR-17): the numbers of the Admins who are texted when sending is stuck or failing.
//
//  - A number is read in exactly two places: `oncallNumberSource` (the ContactResolver's source, in the sender's hand-off transaction; the number
//    goes to the provider call and nowhere else) and `list`, which masks it to its last four digits before it leaves this file. It is never logged,
//    audited or put in an `ops_event`; an error here carries a code, never an input.
//  - `add` and `remove` are one transaction each with their audit record (a change that cannot be audited is not made), under one lock, so the size
//    limit and the duplicate check hold when two Admins press at once. `remove` first skips the number's waiting texts (`skipRecipientDeliveries`,
//    S06.01) and then deletes the row; the trigger on the table detaches the rows already handed off.
//  - Who may do this is the staff guard's rule (`oncall.manage`, Admins at aal2), asked by the caller before it comes here.
//  - `hasNumber` is what the approval asks (alerting, S04.07 with S06.07) when texting is live: at least one on-call number, or no alert is approved.
//  - S08.08, the on-duty Admin (E08 "On-duty Admin"): `setOnDuty` makes one entry the on-duty one, for an Admin account that must be active, an Admin's and
//    have an authenticator (identity's answer, given as `onDutyAdmin`; the migration's guard checks it again), so whoever gets an escalation's text can sign
//    in at aal2 and open the resident's details; the entry that was on duty goes back to being an on-call number. `clearOnDuty` ends it. Each is one
//    transaction with its audit record, under the roster's lock. `escalationRecipients` is whom an escalation's text goes to: the on-duty entry while its
//    account is still such an Admin, else every on-call number; `onDutyState` is what the roster page and the approval view say about it.
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import type { AuditEvent } from "../../audit";
import type { RecipientNumberSource, SkippedForRecipient } from "../../messaging";
import { maskNumber } from "../../messaging";
import { oncallStore, type RosterRow } from "../adapters/oncallStore";
import { ONCALL_MAX_NUMBERS, parseOncallLabel, parseOncallNumber, type OncallRefusal } from "../domain/oncall";

export interface OncallEntry {
  id: string;
  label: string;
  /** The number with all but its last four digits hidden: `+1 ••• ••• 0123`. */
  masked: string;
  createdAt: Date;
  /** S08.08: whether this is the on-duty entry, and the Admin account it belongs to (null for an on-call entry). */
  onDuty: boolean;
  staffId: string | null;
}

export type AddOutcome = { kind: "added"; id: string; label: string; size: number } | { kind: "refused"; problem: OncallRefusal };
export type RemoveOutcome = { kind: "removed"; label: string; size: number; skippedTexts: number } | { kind: "refused"; problem: "not_found" };
export type OnDutyOutcome = { kind: "set"; label: string } | { kind: "cleared"; label: string } | { kind: "refused"; problem: OncallRefusal };

/**
 * Whether an escalation has an on-duty Admin to go to (S08.08): `set` (the entry's account is an active Admin with an authenticator), `stale` (an entry is on
 * duty but its account no longer is one: escalations go to every on-call number), or `none`.
 */
export type OnDutyState = { kind: "set"; entryId: string; staffId: string } | { kind: "stale"; entryId: string; staffId: string } | { kind: "none" };

/** Whom an escalation's text goes to: the on-duty entry, or every entry of the roster (ids only, never a number). */
export interface EscalationRecipientIds {
  ids: string[];
  onDuty: boolean;
}

/** identity's answer (S08.08): whether the account is an active Admin with an authenticator and its own password, read in the caller's executor. */
export type OnDutyAdminCheck = (executor: DbExecutor, staffId: string) => Promise<boolean>;

type RosterAction = "oncall.added" | "oncall.removed" | "oncall.on_duty_set" | "oncall.on_duty_cleared";
type RefusalReason = "validation" | "duplicate" | "conflict" | "not_found";

export interface OncallRosterDeps {
  db: Db;
  audit: {
    record(tx: DbTransaction, event: AuditEvent<RosterAction>): Promise<unknown>;
    recordRefusal(db: Db, event: { action: RosterAction; actorStaffId: string | null; subjectType: string; subjectId: string | null; meta: { reason: RefusalReason } }): Promise<unknown>;
  };
  /** messaging's `createDeliveryQueue().skipRecipientDeliveries`. */
  skipRecipientDeliveries: (tx: DbTransaction, recipient: { kind: "oncall"; id: string }) => Promise<SkippedForRecipient>;
  /** S08.08: identity's check of an on-duty entry's account. Left out, no entry can be put on duty (fail closed). */
  onDutyAdmin?: OnDutyAdminCheck;
  newId?: () => string;
}

export interface OncallRoster {
  list(executor?: DbExecutor): Promise<OncallEntry[]>;
  add(input: { actorStaffId: string; label: unknown; number: unknown }): Promise<AddOutcome>;
  remove(input: { actorStaffId: string; id: unknown }): Promise<RemoveOutcome>;
  /** Whether at least one on-call number exists (reads no number). */
  hasNumber(executor: DbExecutor): Promise<boolean>;
  /** S08.08: the entry becomes the on-duty one, for that Admin account (the one on duty before goes back to being an on-call number). */
  setOnDuty(input: { actorStaffId: string; id: unknown; staffId: unknown }): Promise<OnDutyOutcome>;
  /** S08.08: nobody is on duty any more (the entry stays on the roster). */
  clearOnDuty(input: { actorStaffId: string }): Promise<OnDutyOutcome>;
  /** S08.08: whether an escalation has an on-duty Admin to go to. */
  onDutyState(executor?: DbExecutor): Promise<OnDutyState>;
}

const SUBJECT_TYPE = "oncall_roster";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const REASON: Record<OncallRefusal, RefusalReason> = {
  label_missing: "validation",
  label_too_long: "validation",
  number_invalid: "validation",
  number_duplicate: "duplicate",
  roster_full: "conflict",
  not_found: "not_found",
  not_admin: "validation",
  not_on_duty: "not_found",
};

const entryOf = (row: RosterRow): OncallEntry => ({ id: row.id, label: row.label, masked: maskNumber(row.phone), createdAt: row.createdAt, onDuty: row.role === "on_duty", staffId: row.staffId });

/** Nobody can be put on duty without identity's answer. */
const NO_ADMIN_CHECK: OnDutyAdminCheck = async () => false;

/** Whether an escalation has an on-duty Admin to go to, in the caller's executor. */
export async function onDutyStateOf(executor: DbExecutor, onDutyAdmin: OnDutyAdminCheck): Promise<OnDutyState> {
  const entry = await oncallStore.onDuty(executor);
  if (entry === null) return { kind: "none" };
  return (await onDutyAdmin(executor, entry.staffId)) ? { kind: "set", entryId: entry.id, staffId: entry.staffId } : { kind: "stale", entryId: entry.id, staffId: entry.staffId };
}

/**
 * Whom an escalation's text goes to (S08.08, E08 "On-duty Admin"), read in the mark's transaction: the on-duty entry while its account is an active Admin with
 * an authenticator; otherwise every number of the roster (the on-call Admins, as the health job texts them). Ids only; the numbers stay in the table.
 */
export async function escalationRecipients(executor: DbExecutor, onDutyAdmin: OnDutyAdminCheck): Promise<EscalationRecipientIds> {
  const state = await onDutyStateOf(executor, onDutyAdmin);
  if (state.kind === "set") return { ids: [state.entryId], onDuty: true };
  return { ids: await oncallStore.ids(executor), onDuty: false };
}

export function createOncallRoster(deps: OncallRosterDeps): OncallRoster {
  const { db, audit } = deps;
  const newId = deps.newId ?? (() => uuidv7());
  const onDutyAdmin = deps.onDutyAdmin ?? NO_ADMIN_CHECK;

  return {
    async list(executor) {
      return (await oncallStore.list(executor ?? db)).map(entryOf);
    },

    async hasNumber(executor) {
      return oncallStore.any(executor);
    },

    async add({ actorStaffId, label: rawLabel, number: rawNumber }) {
      const refuse = async (problem: OncallRefusal): Promise<AddOutcome> => {
        await audit.recordRefusal(db, { action: "oncall.added", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: null, meta: { reason: REASON[problem] } });
        return { kind: "refused", problem };
      };
      const label = parseOncallLabel(rawLabel);
      if (!label.ok) return refuse(label.problem);
      const phone = parseOncallNumber(rawNumber);
      if (phone === null) return refuse("number_invalid");
      const outcome = await db.transaction(async (tx): Promise<AddOutcome> => {
        await oncallStore.lockForChange(tx);
        if ((await oncallStore.size(tx)) >= ONCALL_MAX_NUMBERS) return { kind: "refused", problem: "roster_full" };
        const id = await oncallStore.insert(tx, { id: newId(), label: label.label, phone, addedBy: actorStaffId });
        if (id === null) return { kind: "refused", problem: "number_duplicate" };
        const size = await oncallStore.size(tx);
        await audit.record(tx, { action: "oncall.added", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: id, meta: { roster_size: size } });
        return { kind: "added", id, label: label.label, size };
      });
      return outcome.kind === "refused" ? refuse(outcome.problem) : outcome;
    },

    async remove({ actorStaffId, id }) {
      if (typeof id !== "string" || !UUID.test(id)) {
        await audit.recordRefusal(db, { action: "oncall.removed", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: null, meta: { reason: "validation" } });
        return { kind: "refused", problem: "not_found" };
      }
      const outcome = await db.transaction(async (tx): Promise<RemoveOutcome> => {
        await oncallStore.lockForChange(tx);
        const label = await oncallStore.labelOf(tx, id);
        if (label === null) return { kind: "refused", problem: "not_found" };
        // The texts still waiting for this number are skipped first (S06.01), in this transaction, then the row goes.
        const skipped = await deps.skipRecipientDeliveries(tx, { kind: "oncall", id });
        await oncallStore.delete(tx, id);
        const size = await oncallStore.size(tx);
        await audit.record(tx, { action: "oncall.removed", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: id, meta: { roster_size: size } });
        return { kind: "removed", label, size, skippedTexts: skipped.skipped };
      });
      if (outcome.kind === "refused") await audit.recordRefusal(db, { action: "oncall.removed", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: id, meta: { reason: "not_found" } });
      return outcome;
    },

    async onDutyState(executor) {
      return onDutyStateOf(executor ?? db, onDutyAdmin);
    },

    async setOnDuty({ actorStaffId, id, staffId }) {
      const refuse = async (problem: OncallRefusal, subjectId: string | null): Promise<OnDutyOutcome> => {
        await audit.recordRefusal(db, { action: "oncall.on_duty_set", actorStaffId, subjectType: SUBJECT_TYPE, subjectId, meta: { reason: REASON[problem] } });
        return { kind: "refused", problem };
      };
      if (typeof id !== "string" || !UUID.test(id)) return refuse("not_found", null);
      if (typeof staffId !== "string" || !UUID.test(staffId)) return refuse("not_admin", id);
      const outcome = await db.transaction(async (tx): Promise<OnDutyOutcome> => {
        await oncallStore.lockForChange(tx);
        const label = await oncallStore.labelOf(tx, id);
        if (label === null) return { kind: "refused", problem: "not_found" };
        // Read in this transaction: an account suspended, demoted or whose authenticator was reset a moment ago is refused (the table's guard asks again).
        if (!(await onDutyAdmin(tx, staffId))) return { kind: "refused", problem: "not_admin" };
        await oncallStore.clearOnDuty(tx);
        await oncallStore.setOnDuty(tx, id, staffId);
        await audit.record(tx, { action: "oncall.on_duty_set", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: id, meta: { staff_id: staffId } });
        return { kind: "set", label };
      });
      return outcome.kind === "refused" ? refuse(outcome.problem, id) : outcome;
    },

    async clearOnDuty({ actorStaffId }) {
      const outcome = await db.transaction(async (tx): Promise<OnDutyOutcome> => {
        await oncallStore.lockForChange(tx);
        const entry = await oncallStore.onDuty(tx);
        if (entry === null) return { kind: "refused", problem: "not_on_duty" };
        const label = (await oncallStore.labelOf(tx, entry.id)) ?? "";
        await oncallStore.clearOnDuty(tx);
        await audit.record(tx, { action: "oncall.on_duty_cleared", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: entry.id });
        return { kind: "cleared", label };
      });
      if (outcome.kind === "refused") {
        await audit.recordRefusal(db, { action: "oncall.on_duty_cleared", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: null, meta: { reason: REASON[outcome.problem] } });
      }
      return outcome;
    },
  };
}

/** Whether at least one on-call number exists, in the caller's executor (the approval's transaction asks this; no number is read). */
export const hasOncallNumber = (executor: DbExecutor): Promise<boolean> => oncallStore.any(executor);

/**
 * The ContactResolver's source for `oncall` recipients (S06.01's `RecipientNumberSource`), wired by the composition root. It answers with the
 * entry's number inside the hand-off transaction and keeps nothing; null for an entry that was removed meanwhile, so the text is skipped.
 */
export const oncallNumberSource: RecipientNumberSource = {
  numberOf: (tx, recipientId) => oncallStore.phoneOf(tx, recipientId),
};
