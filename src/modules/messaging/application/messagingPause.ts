// The pause (S06.06, AD-8, E06 "Pause"): one switch an Admin at aal2 sets to stop every text that has not yet been handed to the provider,
// and clears to let them go. The sender (S06.02) only reads it, before each claim and again at the hand-off point; this is the one place
// that writes it, so each use case is one transaction on the one `messaging_control` row:
//
//  - pause: lock the row `FOR UPDATE`; if texts are already paused, nothing changes (the answer says who paused and why: two Admins who
//    press at once get one pause and one audit record); otherwise count the texts the pause now holds and the texts already handed
//    to the provider among those of the alerts and campaigns it holds (they "cannot be recalled"), write who, when (the database's
//    clock), why and that count, and write the `sending.paused` audit record in the same transaction, so a pause that cannot be audited
//    is not made (the Admin is told, and can press again);
//  - resume: lock the row; if texts are not paused, nothing changes; otherwise clear the pause, and write `sending.resumed` in the same
//    transaction. The dispatcher then continues in claim order and checks each text again at the hand-off point (an entry superseded or
//    discarded meanwhile, a valid-until that has passed, a closed thread: the text is cancelled or skipped; a closing entry's texts are
//    sent). The caller starts a run right after the transaction commits (`kickDispatcher`), so texts do not wait for pg_cron.
//
// A pause writes no `delivery` row and takes no lock on one (E06 "Hand-off point"): a hand-off already open when the pause commits lets
// that one text go, and it is shown as in flight (disclosed allowance); every text after it finds the pause at its own hand-off.
// Who may pause is the staff guard's rule (the policy action `sending.pause`, Admins, at aal2); the actor id is the guard's, never the
// request's. The reason an Admin types is free text, which an audit record never holds, so it is kept on the switch while the pause lasts.
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import type { AuditEvent } from "../../audit";
import { cleanPauseReason, type PauseReasonProblem } from "../domain/pauseRules";

/** The pause switch as the table holds it. */
export interface PauseRow {
  paused: boolean;
  pausedBy: string | null;
  pausedAt: Date | null;
  reason: string | null;
  handedOffAtPause: number | null;
}

/** What the Hub shows about the pause. `handedOffAtPause` is null for a pause set before the count existed. */
export type PauseStatus =
  | { paused: false }
  | { paused: true; pausedBy: string; pausedAt: Date; reason: string; handedOffAtPause: number | null };

export type PausedStatus = Extract<PauseStatus, { paused: true }>;

/**
 * Port: the pause switch and the counts it states, with Drizzle (adapters/pauseStore.ts). The two counts name only texts the pause
 * applies to (`pauseApplies`: not the texts to on-call numbers).
 */
export interface PauseStore {
  read(executor: DbExecutor): Promise<PauseRow | null>;
  /** The row, locked `FOR UPDATE` in the caller's transaction. */
  lock(tx: DbTransaction): Promise<PauseRow | null>;
  /** Texts the pause holds right now: `queued`, or `claimed` and not yet handed off. */
  countWaiting(tx: DbTransaction): Promise<number>;
  /** Texts already handed to the provider (`handed_off_at` set) among those of the alerts and campaigns that still have a text waiting. */
  countHandedOffOfHeld(tx: DbTransaction): Promise<number>;
  /** Sets the pause only while it is off (the database stamps `paused_at`); null when it was already on. */
  setPaused(tx: DbTransaction, input: { actorStaffId: string; reason: string; handedOff: number }): Promise<PauseRow | null>;
  /** Clears the pause only while it is on; false when it was already off. */
  setResumed(tx: DbTransaction): Promise<boolean>;
}

type ControlEvent = AuditEvent<"sending.paused"> | AuditEvent<"sending.resumed">;

/** Where the use case writes audit records: the audit module's `record` and `recordRefusal`. */
export interface PauseAudit {
  record(tx: DbTransaction, event: ControlEvent): Promise<void>;
  recordRefusal(db: Db, event: ControlEvent): Promise<void>;
}

export interface MessagingPauseDeps {
  db: Db;
  store: PauseStore;
  audit: PauseAudit;
}

export type PauseOutcome =
  /** Texts are now paused. `waiting` texts are held; `handedOff` had already gone to the provider (the pause screen says so). */
  | { kind: "paused"; status: PausedStatus; waiting: number; handedOff: number }
  /** They already were (another Admin was first); nothing changed. */
  | { kind: "already_paused"; status: PausedStatus }
  /** No usable reason was given; nothing changed. */
  | { kind: "refused"; problem: PauseReasonProblem };

export type ResumeOutcome =
  /** The pause ended; `waiting` texts go out now, in claim order. */
  | { kind: "resumed"; waiting: number }
  /** Texts were not paused; nothing changed. */
  | { kind: "not_paused" };

export interface MessagingPause {
  /** What the pause switch says now (an executor of the caller's: the Hub reads it on every screen). */
  status(executor?: DbExecutor): Promise<PauseStatus>;
  /** Pauses all texts with a reason, as the Admin the guard let through. */
  pause(input: { actorStaffId: string; reason: unknown }): Promise<PauseOutcome>;
  /** Resumes texts, as the Admin the guard let through. */
  resume(input: { actorStaffId: string }): Promise<ResumeOutcome>;
}

/** The migration makes the one row and the app cannot delete it: a missing row is a broken database, and the sender already reads it as paused. */
export class MessagingControlMissing extends Error {
  constructor() {
    super("The pause switch (messaging_control) has no row");
    this.name = "MessagingControlMissing";
  }
}

/** A paused row that does not say who, when and why: the table's check refuses it, so this is a database that was changed by hand. */
export class MessagingControlInconsistent extends Error {
  constructor() {
    super("The pause switch is on but does not say who paused, when and why");
    this.name = "MessagingControlInconsistent";
  }
}

/** The status of a row (throws on one that is paused without saying who, when and why). */
export function statusOf(row: PauseRow): PauseStatus {
  if (!row.paused) return { paused: false };
  if (row.pausedBy === null || row.pausedAt === null || row.reason === null) throw new MessagingControlInconsistent();
  return { paused: true, pausedBy: row.pausedBy, pausedAt: row.pausedAt, reason: row.reason, handedOffAtPause: row.handedOffAtPause };
}

const SUBJECT = { subjectType: "messaging_control", subjectId: "1" } as const;

export function createMessagingPause(deps: MessagingPauseDeps): MessagingPause {
  const { db, store, audit } = deps;

  return {
    async status(executor) {
      const row = await store.read(executor ?? db);
      if (!row) throw new MessagingControlMissing();
      return statusOf(row);
    },

    async pause({ actorStaffId, reason: raw }) {
      const cleaned = cleanPauseReason(raw);
      if (!cleaned.ok) {
        await audit.recordRefusal(db, { action: "sending.paused", actorStaffId, ...SUBJECT, meta: { reason: "validation" } });
        return { kind: "refused", problem: cleaned.problem };
      }
      const outcome = await db.transaction(async (tx): Promise<PauseOutcome> => {
        const current = await store.lock(tx);
        if (!current) throw new MessagingControlMissing();
        const status = statusOf(current);
        if (status.paused) return { kind: "already_paused", status };
        const waiting = await store.countWaiting(tx);
        const handedOff = await store.countHandedOffOfHeld(tx);
        const set = await store.setPaused(tx, { actorStaffId, reason: cleaned.reason, handedOff });
        // The row is locked, so it cannot have been paused since it was read: a refusal here is a broken lock, not a race.
        if (!set) throw new MessagingControlInconsistent();
        await audit.record(tx, { action: "sending.paused", actorStaffId, ...SUBJECT, meta: { waiting, handed_off: handedOff } });
        const paused = statusOf(set);
        if (!paused.paused) throw new MessagingControlInconsistent();
        return { kind: "paused", status: paused, waiting, handedOff };
      });
      if (outcome.kind === "already_paused") await audit.recordRefusal(db, { action: "sending.paused", actorStaffId, ...SUBJECT, meta: { reason: "conflict" } });
      return outcome;
    },

    async resume({ actorStaffId }) {
      const outcome = await db.transaction(async (tx): Promise<ResumeOutcome> => {
        const current = await store.lock(tx);
        if (!current) throw new MessagingControlMissing();
        if (!current.paused) return { kind: "not_paused" };
        const waiting = await store.countWaiting(tx);
        if (!(await store.setResumed(tx))) throw new MessagingControlInconsistent();
        await audit.record(tx, { action: "sending.resumed", actorStaffId, ...SUBJECT, meta: { waiting } });
        return { kind: "resumed", waiting };
      });
      if (outcome.kind === "not_paused") await audit.recordRefusal(db, { action: "sending.resumed", actorStaffId, ...SUBJECT, meta: { reason: "conflict" } });
      return outcome;
    },
  };
}
