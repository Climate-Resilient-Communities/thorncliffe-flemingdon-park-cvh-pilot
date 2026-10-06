// An Admin resends texts that did not arrive (S09.02, AR-21 resend, AR-12, FR-G6, E09 definitions "Resend"). A resend is a deliberate action that creates a NEW
// delivery copying an earlier one of the same chain (its root, the chain's first delivery); no row of the chain ever changes. It is the one way a text is sent a
// second time; the sender never does it by itself (E06: a text whose outcome is unclear is `unknown`, never re-sent).
//
//  - One transaction does it all (a "resend all" for an entry and language is one transaction too, so it is all or nothing, with one audit record): for each chain,
//    in the order of the roots' ids (so two Admins pressing at once lock them in the same order), the chain's root is locked `FOR UPDATE` and then the rest of the
//    chain (AD-18: the delivery rows), the decision is made on what is read under those locks (`decideResend`), the resident's row is locked `FOR KEY SHARE SKIP LOCKED` (a deletion
//    or STOP that comes next waits for this transaction and then skips the new text; one that is already running makes the resident "not receiving"), and the next `resend_n` is allocated by the new row's insert, which the database checks again
//    (the unique `(resend_of, resend_n)`, the key `resend:{root}:{n}`, the copy).
//  - Who may resend is the staff guard's rule (the policy action `delivery.resend`: Admins, at aal2), asked by the caller before it comes here; the actor is the
//    guard's, never the request's.
//  - The new row follows E06's sendability rules like any alert text: it is checked here against the entry's standing and the resident's, so the Admin is told why
//    now, and again by the dispatcher at the hand-off point (an entry superseded since, a thread closed, a valid-until passed, a resident gone, a pause).
//  - Spend (S06.08, S07.08): the text is counted once, when the provider accepts it (or its outcome becomes `unknown`), by the sender's own hooks, like every text.
//    A resend counts toward the month's cap and is judged against it like an approval is, by the caller's `spendCap` port: it warns and never blocks. An overrun is
//    audited as `spend.cap_overrun` (on the entry) and recorded as the ops event the health job texts about.
//  - `delivery.resent` is audited in the same transaction with counts (what was resent, what was not), never a number, a recipient or a body.
import type { Db, DbTransaction } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import type { AuditEvent } from "../../audit";
import { alertNotSendable, type AlertStanding, type NotSendableReason } from "../domain/dispatchRules";
import type { RecipientKind } from "../domain/deliveryRules";
import type { DeliveryState } from "../domain/deliveryState";
import {
  BULK_RESEND_LIMIT,
  BULK_RESEND_STATES,
  decideResend,
  resendKey,
  type ChainText,
  type ResendRefusal,
} from "../domain/resend";
import type { ProblemMeaning } from "../domain/sendingProgress";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The root of a chain as the copy needs it: everything that is frozen, and nothing else (no number: a delivery row has none). */
export interface RootText {
  id: string;
  kind: string;
  entryId: string | null;
  recipientKind: string;
  recipientId: string | null;
  lang: string;
  body: string;
  segments: number;
  costEstimateCents: number;
}

/** Port: the statements of a resend, with Drizzle (adapters/resendStore.ts). Every call runs in the caller's transaction. */
export interface ResendStore {
  /** The chain a delivery is in (its root's id), and the entry and kind of the delivery; null when there is no such delivery. */
  locate(tx: DbTransaction, deliveryId: string): Promise<{ rootId: string; entryId: string | null; kind: string } | null>;
  /**
   * The latest text of each chain of the entry and language that is in one of `states` and has not been resent since, in the order of the chains' roots; at most
   * `limit`, and whether there are more.
   */
  bulkCandidates(
    tx: DbTransaction,
    entryId: string,
    lang: string,
    states: readonly DeliveryState[],
    limit: number,
  ): Promise<{ texts: { id: string; rootId: string }[]; more: boolean }>;
  /** The chain's root locked `FOR UPDATE`, then the rest of the chain locked, all read; null when the id is not a chain's root. */
  lockChain(tx: DbTransaction, rootId: string): Promise<{ root: RootText; chain: ChainText[] } | null>;
  /** Adds the resend: a copy of the root with its `resend_of`, `resend_n` and key. The database checks the rules again. */
  insertResend(tx: DbTransaction, input: { id: string; root: RootText; n: number; key: string }): Promise<void>;
}

/** Port, implemented by `subscriptions` and wired by the composition root: whether the resident still receives alerts. Locks their row `FOR KEY SHARE SKIP LOCKED`: never waits, and a row a deletion holds reads as not receiving. */
export interface ResendRecipients {
  receives(tx: DbTransaction, recipient: { kind: RecipientKind; id: string }): Promise<boolean>;
}

/** Port, implemented by `alerting` (its `alertStandingReader`) and wired by the composition root: the entry and its thread, as the hand-off point reads them. */
export interface ResendStanding {
  standingOf(tx: DbTransaction, entryId: string): Promise<AlertStanding | null>;
}

/** Where the use case writes audit records: the audit module's `record` and `recordRefusal`. */
export interface ResendAudit {
  record(tx: DbTransaction, event: AuditEvent<"delivery.resent"> | AuditEvent<"spend.cap_overrun">): Promise<unknown>;
  recordRefusal(db: Db, event: AuditEvent<"delivery.resent">): Promise<unknown>;
}

/** The spend cap's check of a batch of resends (S07.08): how far it takes the month past the cap, or null. Records the ops event of an overrun. It never refuses. */
export type ResendSpendCap = (tx: DbTransaction, input: { entryId: string; estimateCents: number; now: Date }) => Promise<{ overCents: number; capCents: number } | null>;

export interface ResendDeps {
  db: Db;
  store: ResendStore;
  audit: ResendAudit;
  recipients: ResendRecipients;
  standing: ResendStanding;
  spendCap?: ResendSpendCap;
  newId?: () => string;
  now?: () => Date;
}

export type ResendInput = {
  /** The Admin the guard let through. */
  actorStaffId: string;
  /** The entry whose sending view this is: the texts must belong to it. */
  entryId: string;
} & (
  | {
      scope: "one";
      deliveryId: string;
      /** The status the Admin saw (`unknown`, `failed`, `undelivered`), required: a text that is another status now is refused. */
      seen: string;
      /** The Admin's confirmation, for an `unknown` text, that "This text may already have arrived; resending may send it twice". */
      confirmedUnknown: boolean;
    }
  | { scope: "language"; lang: string }
);

/** How many texts were not resent, and why (a "resend all" skips a chain whose number cannot receive texts, or that has two resends already, and goes on). */
export interface NotResent {
  reason: ResendRefusal;
  n: number;
}

export type ResendOutcome =
  | {
      kind: "resent";
      /** New texts made. */
      resent: number;
      /** Of the chains asked for, those that were not resent, with the reason. */
      notResent: NotResent[];
      /** "Resend all" stopped at its limit: there are more chains to take. */
      more: boolean;
      /** The estimate of the new texts in cents (counted in spend when the provider accepts them). */
      costCents: number;
      /** The spend cap was passed by these texts (a warning, never a refusal). */
      overrun: { overCents: number; capCents: number } | null;
      /** For a single resend: which resend of its chain it is. */
      resendN: number | null;
    }
  | {
      kind: "refused";
      reason: ResendRefusal;
      /** The text's status now, when the reason is about it (`status_changed`, `not_resendable`, `already_resent`, `confirm_needed`). */
      status?: DeliveryState;
      /** Why the number cannot receive texts (`cannot_receive`). */
      meaning?: ProblemMeaning;
      /** Why the alert would not send it (`not_sendable`). */
      cause?: NotSendableReason;
    };

export interface Resend {
  resend(input: ResendInput): Promise<ResendOutcome>;
}

type Refused = Extract<ResendOutcome, { kind: "refused" }>;

const refusedWith = (reason: ResendRefusal, extra: Omit<Refused, "kind" | "reason"> = {}): Refused => ({ kind: "refused", reason, ...extra });

export function createResend(deps: ResendDeps): Resend {
  const { db, store, audit } = deps;
  const newId = deps.newId ?? uuidv7;
  const now = deps.now ?? (() => new Date());

  async function run(tx: DbTransaction, input: ResendInput): Promise<ResendOutcome & { isDrill: boolean }> {
    const standing = await deps.standing.standingOf(tx, input.entryId);
    if (standing === null) return { ...refusedWith("not_found"), isDrill: false };
    const isDrill = standing.isDrill;
    // The alert's own rules: a text that would be superseded, closed over or past its valid-until is not made (the dispatcher judges it again at the hand-off).
    const unsendable = alertNotSendable(standing, "subscriber");
    if (unsendable !== null) return { ...refusedWith("not_sendable", { cause: unsendable.reason }), isDrill };

    let candidates: { id: string; rootId: string }[];
    let more = false;
    if (input.scope === "one") {
      const found = UUID.test(input.deliveryId) ? await store.locate(tx, input.deliveryId) : null;
      if (!found || found.entryId !== input.entryId || found.kind !== "alert") return { ...refusedWith("not_found"), isDrill };
      candidates = [{ id: input.deliveryId, rootId: found.rootId }];
    } else {
      const found = await store.bulkCandidates(tx, input.entryId, input.lang, BULK_RESEND_STATES, BULK_RESEND_LIMIT);
      candidates = found.texts;
      more = found.more;
    }

    const plan: { root: RootText; n: number }[] = [];
    const notResent = new Map<ResendRefusal, number>();
    for (const candidate of candidates) {
      const locked = await store.lockChain(tx, candidate.rootId);
      const refuse = (outcome: Refused): Refused | null => {
        if (input.scope === "one") return outcome;
        notResent.set(outcome.reason, (notResent.get(outcome.reason) ?? 0) + 1);
        return null;
      };
      if (!locked || locked.root.entryId !== input.entryId) {
        const stop = refuse(refusedWith("not_found"));
        if (stop) return { ...stop, isDrill };
        continue;
      }
      const decision = decideResend({
        target: candidate.id,
        chain: locked.chain,
        recipientId: locked.root.recipientId,
        recipientIsSubscriber: locked.root.recipientKind === "subscriber",
        seen: input.scope === "one" ? input.seen : null,
        confirmedUnknown: input.scope === "one" && input.confirmedUnknown,
      });
      if (!decision.ok) {
        const stop = refuse(refusedWith(decision.reason, { ...(decision.status ? { status: decision.status } : {}), ...(decision.meaning ? { meaning: decision.meaning } : {}) }));
        if (stop) return { ...stop, isDrill };
        continue;
      }
      // The resident, last: their row is locked FOR KEY SHARE SKIP LOCKED (without waiting), so a deletion or a STOP that comes next waits, then skips the text this transaction adds.
      if (locked.root.recipientId === null || !(await deps.recipients.receives(tx, { kind: "subscriber", id: locked.root.recipientId }))) {
        const stop = refuse(refusedWith("recipient_not_receiving"));
        if (stop) return { ...stop, isDrill };
        continue;
      }
      plan.push({ root: locked.root, n: decision.next });
    }

    const notResentList = [...notResent].map(([reason, n]): NotResent => ({ reason, n })).sort((a, b) => (a.reason < b.reason ? -1 : 1));
    const notResentCount = notResentList.reduce((sum, item) => sum + item.n, 0);
    if (plan.length === 0) {
      // A press that made nothing is still an Admin's privileged act: it is audited with its counts (no cost, so no cap is judged).
      await audit.record(tx, {
        action: "delivery.resent",
        actorStaffId: input.actorStaffId,
        subjectType: "alert_entry",
        subjectId: input.entryId,
        isDrill,
        meta: { scope: input.scope, ...(input.scope === "language" ? { lang: input.lang } : {}), resent: 0, not_resent: notResentCount },
      });
      return { kind: "resent", resent: 0, notResent: notResentList, more, costCents: 0, overrun: null, resendN: null, isDrill };
    }

    // The spend cap is the last lock (AD-18) and is judged before the new texts are added, so their estimate is not counted twice (as the waiting texts).
    const costCents = plan.reduce((sum, item) => sum + item.root.costEstimateCents, 0);
    const overrun = deps.spendCap ? await deps.spendCap(tx, { entryId: input.entryId, estimateCents: costCents, now: now() }) : null;
    for (const item of plan) await store.insertResend(tx, { id: newId(), root: item.root, n: item.n, key: resendKey(item.root.id, item.n) });

    await audit.record(tx, {
      action: "delivery.resent",
      actorStaffId: input.actorStaffId,
      subjectType: "alert_entry",
      subjectId: input.entryId,
      isDrill,
      meta: {
        scope: input.scope,
        ...(input.scope === "language" ? { lang: input.lang } : { resend_n: plan[0].n }),
        resent: plan.length,
        not_resent: notResentCount,
      },
    });
    if (overrun) {
      await audit.record(tx, {
        action: "spend.cap_overrun",
        actorStaffId: input.actorStaffId,
        subjectType: "alert_entry",
        subjectId: input.entryId,
        isDrill,
        meta: { over_cents: overrun.overCents, cap_cents: overrun.capCents, entry_cents: costCents },
      });
    }
    return { kind: "resent", resent: plan.length, notResent: notResentList, more, costCents, overrun, resendN: input.scope === "one" ? plan[0].n : null, isDrill };
  }

  return {
    async resend(input) {
      const subjectId = UUID.test(input.entryId) ? input.entryId : null;
      const result = await db.transaction((tx) => run(tx, input));
      const { isDrill, ...outcome } = result;
      if (outcome.kind === "refused") {
        // A refusal changed nothing; it is recorded after, on its own, with its reason and no more.
        await audit.recordRefusal(db, {
          action: "delivery.resent",
          actorStaffId: input.actorStaffId,
          subjectType: "alert_entry",
          subjectId,
          isDrill,
          meta: { reason: outcome.reason },
        });
      }
      return outcome;
    },
  };
}
