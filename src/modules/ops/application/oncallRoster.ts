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
}

export type AddOutcome = { kind: "added"; id: string; label: string; size: number } | { kind: "refused"; problem: OncallRefusal };
export type RemoveOutcome = { kind: "removed"; label: string; size: number; skippedTexts: number } | { kind: "refused"; problem: "not_found" };

type RosterAction = "oncall.added" | "oncall.removed";
type RefusalReason = "validation" | "duplicate" | "conflict" | "not_found";

export interface OncallRosterDeps {
  db: Db;
  audit: {
    record(tx: DbTransaction, event: AuditEvent<RosterAction>): Promise<unknown>;
    recordRefusal(db: Db, event: { action: RosterAction; actorStaffId: string | null; subjectType: string; subjectId: string | null; meta: { reason: RefusalReason } }): Promise<unknown>;
  };
  /** messaging's `createDeliveryQueue().skipRecipientDeliveries`. */
  skipRecipientDeliveries: (tx: DbTransaction, recipient: { kind: "oncall"; id: string }) => Promise<SkippedForRecipient>;
  newId?: () => string;
}

export interface OncallRoster {
  list(executor?: DbExecutor): Promise<OncallEntry[]>;
  add(input: { actorStaffId: string; label: unknown; number: unknown }): Promise<AddOutcome>;
  remove(input: { actorStaffId: string; id: unknown }): Promise<RemoveOutcome>;
  /** Whether at least one on-call number exists (reads no number). */
  hasNumber(executor: DbExecutor): Promise<boolean>;
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
};

const entryOf = (row: RosterRow): OncallEntry => ({ id: row.id, label: row.label, masked: maskNumber(row.phone), createdAt: row.createdAt });

export function createOncallRoster(deps: OncallRosterDeps): OncallRoster {
  const { db, audit } = deps;
  const newId = deps.newId ?? (() => uuidv7());

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
