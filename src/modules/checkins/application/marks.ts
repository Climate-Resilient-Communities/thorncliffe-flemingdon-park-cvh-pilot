// A mark on a check-in row (S08.07, AD-12, AD-18; E08 definitions "Marks", "Late mark", "Closed stub", "Escalation"), from "My round" (A-04). The staff
// guard has let the call through on the policy action `checkins.mark` (an Ambassador who covers the row's floor, or an Admin); the use case asks again in
// its own transaction, on the person's standing read there (an account suspended or an assignment removed since the guard counts at once).
//
// In one transaction: the row the `round_ref` names is locked (the row only, AD-18's `checkin`); then
//  - no such row (never was, or purged), or a stub closed more than 2 hours ago: refused, nothing recorded against the round, the refusal audited
//    (`round_ended`) without anything about the resident;
//  - a mark whose id the row already took: nothing changes (`already`);
//  - a live row: the mark becomes its latest (`marked`; a later mark replaces an earlier one, and the tally records the latest when the row leaves the
//    round); `not_reached` and `needs_help` also make the row's escalation for that status, unless one is open (at most one open per `round_ref` and
//    status: after the Hub handled it, S08.08, the next mark of that status makes a new one);
//  - a row that has left its round and not expired (a late mark): `not_reached` or `needs_help` makes the escalation for that status unless one is open,
//    with the stub's building and floor and the ambassador only (`hub_told`: "The Hub has been told; call the Hub if you can"); the same late mark sent
//    again (its id is on the escalation it made) makes nothing, even once that escalation is handled; `done` changes nothing (`request_ended`: "This
//    request has ended").
// The escalation is made in the mark's transaction, then handed to the `escalations` seam in the same transaction (S08.08 adds the Hub's list, the
// text to the on-duty Admin and the handling; until then nothing follows it).
import type { MarkOutcome, MarkStatus } from "../../../contracts/checkinRound";
import type { Db, DbTransaction } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import { record, recordRefusal, type AuditEvent } from "../../audit";
import { can, readStaffStanding, type StaffStanding } from "../../identity";
import { markStore, type MarkStore, type NewEscalation } from "../adapters/markStore";
import { decideMark, escalates, markIdOf } from "../domain/marks";
import { listedFloorOf } from "./round";

/** The person marking, as the session names them: their id (their role and assignments are read again in the transaction). */
export interface MarkActor {
  staffId: string;
}

export interface MarkInput {
  /** The id the page made when the ambassador tapped (sent again with the same id until an answer comes). */
  markId: string;
  roundRef: string;
  status: MarkStatus;
}

/** Why a mark was refused: the round has ended (or never was), or the row's floor is not the person's now. Both are a 403. */
export type MarkRefusal = "round_ended" | "out_of_scope";

export type MarkResult = { ok: true; outcome: MarkOutcome } | { ok: false; refusal: MarkRefusal };

/**
 * Seam (S08.08): what follows an escalation in the mark's own transaction (the Hub's list reads the row; the text to the on-duty Admin is queued here).
 * Never given the subscriber or a number: the escalation holds none.
 */
export interface EscalationFollowUp {
  raised(tx: DbTransaction, escalation: NewEscalation): Promise<void>;
}

/** Until S08.08: the escalation is recorded and nothing else follows. */
export const NO_ESCALATION_FOLLOW_UP: EscalationFollowUp = { raised: async () => {} };

/** The audit trail's writers (checkins may use the audit module, AD-2); a test can replace them. */
export interface MarksAudit {
  record(tx: DbTransaction, event: AuditEvent): Promise<void>;
  recordRefusal(db: Db, event: AuditEvent): Promise<void>;
}

export interface MarksDeps {
  db: Db;
  escalations?: EscalationFollowUp;
  audit?: MarksAudit;
  store?: MarkStore;
  /** identity's standing reader, in the mark's transaction; a test can replace it. */
  standing?: (tx: DbTransaction, staffId: string) => Promise<StaffStanding | null>;
  newId?: () => string;
}

export interface Marks {
  mark(actor: MarkActor, input: MarkInput): Promise<MarkResult>;
}

/** Found inside the transaction: nothing was written, and the refusal is audited after the rollback. */
class Refused extends Error {
  constructor(readonly refusal: MarkRefusal) {
    super(refusal);
  }
}

/**
 * Whether this person may mark a row on this floor now: active, and the role policy's `checkins.mark` on their current assignments. The floor is null
 * when it is no longer one of the building's floors (`listedFloorOf`): no Ambassador covers it.
 */
function mayMark(standing: StaffStanding | null, place: { rsn: string; floorId: string | null }): boolean {
  if (standing === null || standing.status !== "active") return false;
  return can(standing.role, "checkins.mark", { assignments: standing.assignments, target: { rsn: place.rsn, floorId: place.floorId } });
}

export function createMarks(deps: MarksDeps): Marks {
  const store = deps.store ?? markStore;
  const audit: MarksAudit = deps.audit ?? { record, recordRefusal };
  const escalations = deps.escalations ?? NO_ESCALATION_FOLLOW_UP;
  const standingOf = deps.standing ?? ((tx, staffId) => readStaffStanding(tx, staffId));
  const newId = deps.newId ?? (() => uuidv7());

  return {
    async mark(actor, input) {
      // The id as the row keeps it (lower case), so a mark sent again in another case is still the one mark.
      const markId = markIdOf(input.markId);
      try {
        const outcome = await deps.db.transaction(async (tx): Promise<MarkOutcome> => {
          const row = await store.lockForMark(tx, input.roundRef);
          if (row === null) throw new Refused("round_ended");
          if (!mayMark(await standingOf(tx, actor.staffId), { rsn: row.rsn, floorId: await listedFloorOf(tx, row.rsn, row.floorId) })) throw new Refused("out_of_scope");
          const decision = decideMark(row, { id: markId, status: input.status });
          if (decision === "round_ended") throw new Refused("round_ended");
          if (decision === "already") return "already";
          if (decision === "ended") return "request_ended";
          const late = decision === "escalate";
          // A late mark's id cannot be kept on a stub: the escalation it made keeps it, so the mark sent again is the one mark even after the Hub handled it.
          if (late && (await store.escalatedBy(tx, input.roundRef, markId))) return "hub_told";
          if (!late) await store.applyMark(tx, input.roundRef, { id: markId, status: input.status });
          let escalated = false;
          if (escalates(input.status)) {
            const escalation: NewEscalation = { id: newId(), roundRef: input.roundRef, status: input.status, alertId: row.alertId, rsn: row.rsn, floorId: row.floorId, raisedBy: actor.staffId, late, markId };
            escalated = await store.raiseEscalation(tx, escalation);
            if (escalated) await escalations.raised(tx, escalation);
          }
          // A late mark that finds an escalation of its status open (made by another id) changes nothing: it is answered the same, and not recorded again.
          if (late && !escalated) return "hub_told";
          await audit.record(tx, { action: "checkin.marked", actorStaffId: actor.staffId, subjectType: "alert", subjectId: row.alertId, meta: { status: input.status, late, escalated } });
          return late ? "hub_told" : "marked";
        });
        return { ok: true, outcome };
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        await audit.recordRefusal(deps.db, { action: "checkin.marked", actorStaffId: actor.staffId, subjectType: "checkin", subjectId: null, meta: { reason: error.refusal } });
        return { ok: false, refusal: error.refusal };
      }
    },
  };
}
