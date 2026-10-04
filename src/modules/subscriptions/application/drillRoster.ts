// The drill roster (S06.05, AD-6, AD-13, AR-12, AR-17): the staff phones a drill is texted on. It is protected as the on-call roster is (S06.07):
//
//  - A number is read in exactly two places: `drillNumberSource` (the ContactResolver's source, in the sender's hand-off transaction; the number goes to
//    the provider call and nowhere else) and `list`, which masks it to its last four digits before it leaves this file. It is never logged, audited or put
//    in a `delivery` row; an error here carries a code, never an input. The approval reads only ids and languages (`members`).
//  - `add`, `edit` and `remove` are one transaction each with their audit record (a change that cannot be audited is not made), under one lock, so the size
//    limit and the duplicate check hold when two Admins press at once. `remove` first skips the member's waiting texts (`skipRecipientDeliveries`, S06.01)
//    and then deletes the row; the trigger on the table detaches the rows already handed off. The member's row is locked FOR UPDATE
//    before the skip, so an approval that holds it FOR SHARE has committed its texts by then and they are skipped too (none is left to be handed to a removed member).
//  - Who may do this is the staff guard's rule (`drill.run`, Admins at aal2), asked by the caller before it comes here.
import type { LangCode } from "../../../contracts/lang";
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import type { AuditEvent } from "../../audit";
import { maskNumber, type RecipientNumberSource, type SkippedForRecipient } from "../../messaging";
import { drillRosterStore, type DrillMember, type DrillRosterRow } from "../adapters/drillRosterStore";
import { DRILL_ROSTER_MAX, parseRosterLabel, parseRosterLang, parseRosterNumber, type DrillRosterRefusal } from "../domain/drillRoster";

export interface DrillRosterEntry {
  id: string;
  label: string;
  /** The number with all but its last four digits hidden: `+1 ••• ••• 0123`. */
  masked: string;
  lang: LangCode;
  createdAt: Date;
}

export type AddOutcome = { kind: "added"; id: string; label: string; size: number } | { kind: "refused"; problem: DrillRosterRefusal };
export type EditOutcome = { kind: "edited"; label: string; size: number } | { kind: "refused"; problem: DrillRosterRefusal };
export type RemoveOutcome = { kind: "removed"; label: string; size: number; skippedTexts: number } | { kind: "refused"; problem: "not_found" };

type RosterAction = "drill_roster.added" | "drill_roster.edited" | "drill_roster.removed";
type RefusalReason = "validation" | "duplicate" | "conflict" | "not_found";

export interface DrillRosterDeps {
  db: Db;
  audit: {
    record(tx: DbTransaction, event: AuditEvent<RosterAction>): Promise<unknown>;
    recordRefusal(db: Db, event: { action: RosterAction; actorStaffId: string | null; subjectType: string; subjectId: string | null; meta: { reason: RefusalReason } }): Promise<unknown>;
  };
  /** messaging's `createDeliveryQueue().skipRecipientDeliveries`. */
  skipRecipientDeliveries: (tx: DbTransaction, recipient: { kind: "roster"; id: string }) => Promise<SkippedForRecipient>;
  newId?: () => string;
}

export interface DrillRoster {
  list(executor?: DbExecutor): Promise<DrillRosterEntry[]>;
  /** How many members there are (no number is read). */
  size(executor?: DbExecutor): Promise<number>;
  /** The labels of some members by id, for the drill view (never a number). */
  labelsOf(ids: readonly string[], executor?: DbExecutor): Promise<Map<string, string>>;
  add(input: { actorStaffId: string; label: unknown; number: unknown; lang: unknown }): Promise<AddOutcome>;
  /** Changes a member's label and language, and their number when one is given (left empty, the number stays as it is). */
  edit(input: { actorStaffId: string; id: unknown; label: unknown; number: unknown; lang: unknown }): Promise<EditOutcome>;
  remove(input: { actorStaffId: string; id: unknown }): Promise<RemoveOutcome>;
}

const SUBJECT_TYPE = "drill_roster";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const REASON: Record<DrillRosterRefusal, RefusalReason> = {
  label_missing: "validation",
  label_too_long: "validation",
  number_invalid: "validation",
  language_invalid: "validation",
  number_duplicate: "duplicate",
  roster_full: "conflict",
  not_found: "not_found",
};

const entryOf = (row: DrillRosterRow): DrillRosterEntry => ({ id: row.id, label: row.label, masked: maskNumber(row.phone), lang: row.lang, createdAt: row.createdAt });

export function createDrillRoster(deps: DrillRosterDeps): DrillRoster {
  const { db, audit } = deps;
  const newId = deps.newId ?? (() => uuidv7());

  return {
    async list(executor) {
      return (await drillRosterStore.list(executor ?? db)).map(entryOf);
    },

    async size(executor) {
      return drillRosterStore.size(executor ?? db);
    },

    async labelsOf(ids, executor) {
      return drillRosterStore.labelsOf(executor ?? db, ids);
    },

    async add({ actorStaffId, label: rawLabel, number: rawNumber, lang: rawLang }) {
      const refuse = async (problem: DrillRosterRefusal): Promise<AddOutcome> => {
        await audit.recordRefusal(db, { action: "drill_roster.added", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: null, meta: { reason: REASON[problem] } });
        return { kind: "refused", problem };
      };
      const label = parseRosterLabel(rawLabel);
      if (!label.ok) return refuse(label.problem);
      const phone = parseRosterNumber(rawNumber);
      if (phone === null) return refuse("number_invalid");
      const lang = parseRosterLang(rawLang);
      if (lang === null) return refuse("language_invalid");
      const outcome = await db.transaction(async (tx): Promise<AddOutcome> => {
        await drillRosterStore.lockForChange(tx);
        if ((await drillRosterStore.size(tx)) >= DRILL_ROSTER_MAX) return { kind: "refused", problem: "roster_full" };
        const id = await drillRosterStore.insert(tx, { id: newId(), label: label.label, phone, lang, addedBy: actorStaffId });
        if (id === null) return { kind: "refused", problem: "number_duplicate" };
        const size = await drillRosterStore.size(tx);
        await audit.record(tx, { action: "drill_roster.added", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: id, meta: { roster_size: size } });
        return { kind: "added", id, label: label.label, size };
      });
      return outcome.kind === "refused" ? refuse(outcome.problem) : outcome;
    },

    async edit({ actorStaffId, id, label: rawLabel, number: rawNumber, lang: rawLang }) {
      const subjectId = typeof id === "string" && UUID.test(id) ? id : null;
      const refuse = async (problem: DrillRosterRefusal): Promise<EditOutcome> => {
        await audit.recordRefusal(db, { action: "drill_roster.edited", actorStaffId, subjectType: SUBJECT_TYPE, subjectId, meta: { reason: REASON[problem] } });
        return { kind: "refused", problem };
      };
      if (subjectId === null) return refuse("not_found");
      const label = parseRosterLabel(rawLabel);
      if (!label.ok) return refuse(label.problem);
      // An empty number keeps the member's number; anything else must be one.
      const keepsNumber = typeof rawNumber === "string" && rawNumber.trim() === "";
      const phone = keepsNumber ? null : parseRosterNumber(rawNumber);
      if (!keepsNumber && phone === null) return refuse("number_invalid");
      const lang = parseRosterLang(rawLang);
      if (lang === null) return refuse("language_invalid");
      const outcome = await db.transaction(async (tx): Promise<EditOutcome> => {
        await drillRosterStore.lockForChange(tx);
        if ((await drillRosterStore.labelOf(tx, subjectId)) === null) return { kind: "refused", problem: "not_found" };
        if (phone !== null && (await drillRosterStore.numberTakenByAnother(tx, phone, subjectId))) return { kind: "refused", problem: "number_duplicate" };
        await drillRosterStore.update(tx, subjectId, { label: label.label, phone, lang });
        const size = await drillRosterStore.size(tx);
        await audit.record(tx, { action: "drill_roster.edited", actorStaffId, subjectType: SUBJECT_TYPE, subjectId, meta: { roster_size: size } });
        return { kind: "edited", label: label.label, size };
      });
      return outcome.kind === "refused" ? refuse(outcome.problem) : outcome;
    },

    async remove({ actorStaffId, id }) {
      if (typeof id !== "string" || !UUID.test(id)) {
        await audit.recordRefusal(db, { action: "drill_roster.removed", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: null, meta: { reason: "validation" } });
        return { kind: "refused", problem: "not_found" };
      }
      const outcome = await db.transaction(async (tx): Promise<RemoveOutcome> => {
        await drillRosterStore.lockForChange(tx);
        // The member's row is locked first: an approval that holds it FOR SHARE commits before this goes on, so the skip below sees the texts it wrote.
        const label = await drillRosterStore.labelOfLocked(tx, id);
        if (label === null) return { kind: "refused", problem: "not_found" };
        // The texts still waiting for this member are skipped (S06.01), in this transaction, then the row goes.
        const skipped = await deps.skipRecipientDeliveries(tx, { kind: "roster", id });
        await drillRosterStore.delete(tx, id);
        const size = await drillRosterStore.size(tx);
        await audit.record(tx, { action: "drill_roster.removed", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: id, meta: { roster_size: size } });
        return { kind: "removed", label, size, skippedTexts: skipped.skipped };
      });
      if (outcome.kind === "refused") await audit.recordRefusal(db, { action: "drill_roster.removed", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: id, meta: { reason: "not_found" } });
      return outcome;
    },
  };
}

/**
 * The ContactResolver's source for `roster` recipients (S06.01's `RecipientNumberSource`), wired by the composition root. It answers with the member's
 * number inside the hand-off transaction and keeps nothing; null for a member who was removed meanwhile, so the text is skipped, and for anything but an
 * alert text (a roster member is only ever texted a drill alert).
 */
export const drillNumberSource: RecipientNumberSource = {
  numberOf: async (tx, recipientId, options) => (options.deliveryKind === "alert" ? drillRosterStore.phoneOf(tx, recipientId) : null),
};

/** The members a drill is texted, with their languages and no number (the approval's count and capture read this). */
export type { DrillMember };
