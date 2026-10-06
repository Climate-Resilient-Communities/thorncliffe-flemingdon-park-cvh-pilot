// What follows an escalation (S08.08, AD-12, AD-13, AD-18; E08 definitions "Escalation", "On-duty Admin", "Closed stub", "Round tally"):
//
//  - `closeRound(tx, alertId)`: alerting's `closeAlert` (S05.02, the one way a thread closes: a final's approval, a withdrawal that leaves nothing, the
//    expire job) calls it in the closing transaction, after the thread's texts are cancelled (AD-18: the delivery rows, then `checkin`, then
//    `checkin_tally`). Every row of the round is tallied then; `pending` and `done` rows become closed stubs, a `not_reached` or `needs_help` row the Hub
//    has not handled keeps its subscriber for the follow-up (until handled, or 24 hours later by the purge job).
//  - The text (`createEscalationTexts`, the marks' `EscalationFollowUp` seam, S08.07): in the mark's own transaction, one `transactional` text (purpose
//    `escalation`, recipient kind `oncall`) to the on-duty Admin, or to every on-call number when no on-duty Admin is set: "{status}: {building}, floor
//    {n}. Open: {link}", built by messaging's renderer, never with the resident's number. The outbox claims it after fire and evacuation alerts and
//    sends it during a pause (an on-call text, S06.02, S06.06); the Hub's list reads the escalation row and waits for nothing.
//  - The handling (`createEscalationHandling`): an Admin marks an escalation handled with a note; a kept row whose every escalation is handled then
//    becomes a closed stub. Audited without the number or the note.
//  - The reads of the Hub's list (O-17) and an escalation's page: the escalations and, for an Admin, which subscriber the row names (the app composes the
//    number from subscriptions and shows it only to an Admin at aal2).
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import { record, recordRefusal, type AuditEvent } from "../../audit";
import { readStaffStanding, type StaffStanding } from "../../identity";
import type { DeliveryResult, Enqueued, TransactionalInput } from "../../messaging";
import { escalationStore, type EscalatedRow, type EscalationRow, type EscalationStore, type RoundClosed } from "../adapters/escalationStore";
import type { NewEscalation } from "../adapters/markStore";
import { parseHandledNote, type HandleRefusal } from "../domain/escalations";
import type { EscalationFollowUp } from "./marks";

/** The thread's round ends with it: every row tallied, the rows kept for the Hub's follow-up kept (the caller holds the thread, AD-18). */
export function closeRound(tx: DbTransaction, alertId: string, store: EscalationStore = escalationStore): Promise<RoundClosed> {
  return store.closeThreadRows(tx, alertId);
}

// ---------------------------------------------------------------- the text to the on-duty Admin

/** Whom an escalation's text goes to: the on-duty Admin's roster entry, or every on-call number (ops' roster ids; never a number). */
export interface EscalationRecipients {
  ids: string[];
  onDuty: boolean;
}

/** The words of a place, as the text names it: the building's address and the floor's label (places'). */
export interface EscalationPlace {
  building: string;
  floor: string;
}

export interface EscalationTextsDeps {
  /** ops' recipients of an escalation, read in the mark's transaction (the on-duty entry when its account is still an active Admin with an authenticator). */
  recipients: (tx: DbTransaction) => Promise<EscalationRecipients>;
  /** places' address of the building and label of the floor; the register's number and "a floor no longer in the register" when they are gone. */
  place: (tx: DbTransaction, rsn: string, floorId: string) => Promise<EscalationPlace>;
  /** messaging's renderer of the text (AD-21): one line in English, normalised and counted as every outbound text is. */
  render: (input: { status: "not_reached" | "needs_help"; building: string; floor: string; link: string }) => { body: string; segments: number };
  /** The staff link to the escalation's page (PUBLIC_BASE_URL and the page's path). */
  link: (escalationId: string) => string;
  /** messaging's `createDeliveryQueue().enqueueTransactional`. */
  enqueue: (tx: DbTransaction, input: TransactionalInput) => Promise<DeliveryResult<Enqueued>>;
  /** Cents CAD per text message segment (SMS_PRICE_PER_SEGMENT_CENTS), for each text's cost estimate. */
  pricePerSegmentCents: () => number;
}

/**
 * The marks' follow-up of a new escalation: one text per recipient, in the mark's transaction, keyed `transactional:{escalation}:escalation:{roster entry}`
 * (one text per escalation and number, whatever retries). A refusal from the outbox is a bug here, so it throws and the mark rolls back with it: an
 * escalation is never on the list without its text queued. With an empty roster nothing is queued and the list still shows it.
 */
export function createEscalationTexts(deps: EscalationTextsDeps): EscalationFollowUp {
  return {
    async raised(tx, escalation: NewEscalation) {
      const { ids } = await deps.recipients(tx);
      if (ids.length === 0) return;
      const place = await deps.place(tx, escalation.rsn, escalation.floorId);
      const { body, segments } = deps.render({ status: escalation.status, building: place.building, floor: place.floor, link: deps.link(escalation.id) });
      const costEstimateCents = Math.ceil(segments * deps.pricePerSegmentCents());
      for (const id of ids) {
        const queued = await deps.enqueue(tx, {
          module: "checkins",
          purpose: "escalation",
          recipient: { kind: "oncall", id },
          subject: escalation.id,
          nonce: id,
          lang: "en",
          body,
          segments,
          costEstimateCents,
        });
        if (!queued.ok) throw new Error(`checkins: the outbox refused an escalation's text (${queued.error})`);
      }
    },
  };
}

// ---------------------------------------------------------------- the Hub's reads

/** How far back the list shows escalations the Hub has handled (the open ones are always shown). */
export const HANDLED_SHOWN_MS = 7 * 24 * 60 * 60 * 1000;
/** The most escalations the list shows. */
export const ESCALATIONS_LISTED = 200;

/** The escalations of the Hub's list (O-17): the open ones first, then those handled in the last 7 days; newest first in each. */
export function escalationList(executor: DbExecutor, now: Date, store: EscalationStore = escalationStore): Promise<EscalationRow[]> {
  return store.list(executor, { handledSince: new Date(now.getTime() - HANDLED_SHOWN_MS), limit: ESCALATIONS_LISTED });
}

/** One escalation and the row it is about (whether it still names its subscriber); null when there is no such escalation. */
export async function escalationOf(executor: DbExecutor, id: string, store: EscalationStore = escalationStore): Promise<{ escalation: EscalationRow; row: EscalatedRow } | null> {
  const escalation = await store.get(executor, id);
  if (escalation === null) return null;
  return { escalation, row: await store.escalatedRow(executor, id) };
}

/** The escalations of the rows that still name the subscriber, keyed by the row's `round_ref` (S09.03's access request, read-only). */
export function subscriberEscalations(executor: DbExecutor, subscriberId: string, store: EscalationStore = escalationStore) {
  return store.ofSubscriberRows(executor, subscriberId);
}

// ---------------------------------------------------------------- the handling

type HandleAction = "checkin.escalation_handled";
type RefusalReason = "validation" | "not_found" | "conflict" | "forbidden";

export interface EscalationHandlingDeps {
  db: Db;
  audit?: {
    record(tx: DbTransaction, event: AuditEvent<HandleAction>): Promise<void>;
    recordRefusal(db: Db, event: AuditEvent<HandleAction>): Promise<void>;
  };
  store?: EscalationStore;
  /** identity's standing reader, in the handling's transaction; a test can replace it. */
  standing?: (tx: DbTransaction, staffId: string) => Promise<StaffStanding | null>;
}

export type HandleOutcome = { kind: "handled"; rowClosed: boolean } | { kind: "refused"; problem: HandleRefusal };

export interface EscalationHandling {
  handle(input: { actorStaffId: string; escalationId: unknown; note: unknown }): Promise<HandleOutcome>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REASON: Record<HandleRefusal, RefusalReason> = {
  note_missing: "validation",
  note_too_long: "validation",
  not_found: "not_found",
  already_handled: "conflict",
  not_admin: "forbidden",
};

class Refused extends Error {
  constructor(readonly problem: HandleRefusal) {
    super(problem);
  }
}

/**
 * "Mark handled" (E08 "Escalation"): an Admin, asked again on their standing in the transaction (the guard let an Admin at aal2 through), marks the
 * escalation handled with their note. In one transaction: the row the escalation is about is locked (if it is still there), then the escalation; one already
 * handled is refused (`already_handled`); the escalation is marked; a row kept for the follow-up whose every escalation is now handled becomes a closed stub
 * (the resident's number is gone from it); the handling is audited with its status and whether the row closed, never the note or a number.
 */
export function createEscalationHandling(deps: EscalationHandlingDeps): EscalationHandling {
  const store = deps.store ?? escalationStore;
  const audit = deps.audit ?? { record, recordRefusal };
  const standingOf = deps.standing ?? ((tx, staffId) => readStaffStanding(tx, staffId));

  return {
    async handle({ actorStaffId, escalationId, note: rawNote }) {
      const refuse = async (problem: HandleRefusal, subjectId: string | null): Promise<HandleOutcome> => {
        await audit.recordRefusal(deps.db, { action: "checkin.escalation_handled", actorStaffId, subjectType: "checkin_escalation", subjectId, meta: { reason: REASON[problem] } });
        return { kind: "refused", problem };
      };
      if (typeof escalationId !== "string" || !UUID.test(escalationId)) return refuse("not_found", null);
      const note = parseHandledNote(rawNote);
      if (!note.ok) return refuse(note.problem, escalationId);
      try {
        return await deps.db.transaction(async (tx): Promise<HandleOutcome> => {
          const standing = await standingOf(tx, actorStaffId);
          if (standing === null || standing.status !== "active" || standing.role !== "admin") throw new Refused("not_admin");
          const roundRef = await store.roundRefOf(tx, escalationId);
          if (roundRef === null) throw new Refused("not_found");
          // The row first, then its escalation: a mark's order (AD-18's `checkin`, then the escalation it makes).
          await store.lockRow(tx, roundRef);
          const escalation = await store.lockEscalation(tx, escalationId);
          if (escalation === null) throw new Refused("not_found");
          if (escalation.handledAt !== null || !(await store.markHandled(tx, escalationId, { by: actorStaffId, note: note.note }))) throw new Refused("already_handled");
          const rowClosed = await store.closeKeptIfHandled(tx, roundRef);
          await audit.record(tx, {
            action: "checkin.escalation_handled",
            actorStaffId,
            subjectType: "checkin_escalation",
            subjectId: escalationId,
            meta: { status: escalation.status, late: escalation.late, row_closed: rowClosed },
          });
          return { kind: "handled", rowClosed };
        });
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        return refuse(error.problem, escalationId);
      }
    },
  };
}
