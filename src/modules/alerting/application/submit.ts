// Submit, end to end (S04.05; AD-5, AD-10, AD-18, AD-21): one press of Submit (or of "Try translation again") from the browser's
// key to a frozen, pending entry, built from the lifecycle's short transactions and the preparer that runs outside any lock.
//
//   1. beginSubmit      one short transaction under the thread's lock: the key's first result if there is one (nothing else
//                       happens), a refusal if the draft cannot be submitted or another attempt runs, else the attempt is
//                       recorded `running`;
//   2. prepare          translate, render, count and hash, OUTSIDE any database lock and transaction. Each language that settles
//                       is written to the attempt (progress), so a browser can show it; the budget is the longest route
//                       deadline plus 5 s and a backstop ends the translation inside it (translation's submit translator);
//   3. completeSubmit   one short transaction: the attempt is still this one's, the draft has not changed since Submit was
//                       pressed, then the frozen content is written as the next version with its hash, the entry moves to
//                       `pending_approval` and the attempt is `committed`.
//
// Nothing is frozen unless step 3 commits. A translation that cannot be made (the routes could not be read in time, or hold a row
// that is not a route) is refused with its own message and an ops event; it is never turned into a half result. A refusal at any
// step ends the attempt as `failed` and leaves the entry a draft with its text. The report says only how the attempt ended; the
// entry's stored state (which the browser fetches when it did not see the outcome) is `entryState`.
import { AlertRoutesUnavailableError, RouteConfigError } from "../../translation";
import { FROZEN_LANGS } from "../domain/translations";
import type { AlertRefusal } from "../domain/refusals";
import type { AttemptState } from "../domain/submitAttempt";
import type { AlertActor, EntryPreparer, FreezeResult } from "./ports";
import type { AlertLifecycle, ApprovalBinding, EntryRef, SubmitStart } from "./lifecycle";
import type { AlertSubmitFailureReason, OpsEvent } from "../../ops";

/** How an attempt ended, or why none was made. */
export type SubmitReport =
  /** Nothing was started (the draft cannot be submitted, or another attempt is running, or the key is not one): the entry is as it was. */
  | { state: "refused"; refusal: AlertRefusal }
  /** An attempt exists: it is running, committed or failed. For a failed one, `outcome` is why. */
  | { state: AttemptState; key: string; outcome: AlertRefusal | null };

export interface SubmitterDeps {
  lifecycle: Pick<AlertLifecycle, "beginSubmit" | "completeSubmit" | "failSubmit" | "recordProgress" | "recordBudget" | "entryState">;
  preparer: EntryPreparer;
  /** Writes one operational event (AD-23). A failure to write is swallowed: it never changes a submit. */
  ops: { record(event: OpsEvent): Promise<void> };
  /** Whether a translation model is configured: with none, every language falling back is expected and not an ops event. Defaults to true. */
  translationConfigured?: boolean;
  now?: () => Date;
  /** How long to wait for the progress writes still pending when the preparation ends. Defaults to 1000. */
  settleMs?: number;
}

const REASON_OF: Partial<Record<AlertRefusal, AlertSubmitFailureReason>> = {
  ROUTES_UNAVAILABLE: "routes_unavailable",
  ROUTES_INVALID: "routes_invalid",
  SMS_BODY_TOO_LONG: "sms_body_too_long",
  TRANSLATION_STALE: "translation_stale",
  PREPARATION_FAILED: "preparation_failed",
};

/** What a preparation that threw means: the routes (named) or anything else (a failed preparation). */
export function refusalOfPreparationError(error: unknown): AlertRefusal {
  if (error instanceof AlertRoutesUnavailableError) return "ROUTES_UNAVAILABLE";
  if (error instanceof RouteConfigError) return "ROUTES_INVALID";
  return "PREPARATION_FAILED";
}

export function createSubmitter(deps: SubmitterDeps) {
  const { lifecycle, preparer, ops } = deps;
  const now = deps.now ?? (() => new Date());
  const settleMs = deps.settleMs ?? 1000;

  const recordOps = async (event: OpsEvent) => {
    try {
      await ops.record(event);
    } catch {
      // The log of operational events failing must not turn a submit into a failure.
    }
  };

  /** Waits for the writes still pending, no longer than `settleMs`: the progress of a language that is already settled is never worth a wait. */
  async function settle(writes: readonly Promise<unknown>[]): Promise<void> {
    if (writes.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled(writes), new Promise<void>((resolve) => (timer = setTimeout(resolve, settleMs)))]);
    clearTimeout(timer);
  }

  async function run(actor: AlertActor, ref: EntryRef, key: string, mode: Parameters<AlertLifecycle["beginSubmit"]>[3]): Promise<SubmitReport> {
    const began = await lifecycle.beginSubmit(actor, ref, key, mode);
    if (!began.ok) return { state: "refused", refusal: began.error };
    const start: SubmitStart = began.value;
    if (start.kind === "replay") return { state: start.attempt.state, key, outcome: start.attempt.outcome };

    const startedAt = now().getTime();
    const elapsed = () => Math.max(0, Math.min(1_000_000, now().getTime() - startedAt));
    const failed = async (outcome: AlertRefusal): Promise<SubmitReport> => {
      await lifecycle.failSubmit(actor, ref, key, outcome, start.context.isDrill);
      const reason = REASON_OF[outcome];
      if (reason) await recordOps({ kind: "alert.submit_failed", subjectType: "alert_entry", subjectId: ref.entryId, detail: { reason, ms: elapsed() } });
      return { state: "failed", key, outcome };
    };

    const writes: Promise<unknown>[] = [];
    const track = (write: Promise<unknown>) => writes.push(write.catch(() => undefined));
    let prepared: FreezeResult;
    try {
      prepared = await preparer.prepare(start.expected, start.context, {
        onBudget: (budgetMs) => track(lifecycle.recordBudget(ref, key, budgetMs)),
        onLanguage: (translation) => track(lifecycle.recordProgress(ref, key, translation.lang, translation.status)),
      });
    } catch (error) {
      await settle(writes);
      return failed(refusalOfPreparationError(error));
    }
    await settle(writes);
    if (!prepared.ok) return failed(prepared.error);

    let done: Awaited<ReturnType<AlertLifecycle["completeSubmit"]>>;
    try {
      done = await lifecycle.completeSubmit(actor, ref, key, prepared.value, start.expected, start.possibleDuplicateOf);
    } catch {
      // The freezing transaction failed (the database, not a rule): nothing was frozen, and the attempt ends failed.
      await lifecycle.failSubmit(actor, ref, key, "PREPARATION_FAILED", start.context.isDrill);
      await recordOps({ kind: "alert.submit_failed", subjectType: "alert_entry", subjectId: ref.entryId, detail: { reason: "commit_failed", ms: elapsed() } });
      return { state: "failed", key, outcome: "PREPARATION_FAILED" };
    }
    // A refusal here (DRAFT_CHANGED: "This alert changed while it was being prepared. Submit again.") was audited and ended the attempt as failed.
    if (!done.ok) return { state: "failed", key, outcome: done.error };

    const fellBack = prepared.value.translations.filter((translation) => translation.status === "fallback_en").length;
    if (fellBack > 0 && deps.translationConfigured !== false) {
      await recordOps({ kind: "alert.translation_fallback", subjectType: "alert_entry", subjectId: ref.entryId, detail: { languages: Math.min(fellBack, FROZEN_LANGS.length) } });
    }
    return { state: "committed", key, outcome: null };
  }

  return {
    /** One press of Submit: the draft is translated, rendered and frozen as the next version, or nothing is. The same key returns the first attempt's result. */
    submit(actor: AlertActor, ref: EntryRef, key: string): Promise<SubmitReport> {
      return run(actor, ref, key, { kind: "submit" });
    },

    /** "Try translation again" on a pending entry (S04.03): back to draft, translated again (what already passed comes from the cache) and re-submitted as the next version. */
    retranslate(actor: AlertActor, ref: EntryRef, key: string, seen: ApprovalBinding): Promise<SubmitReport> {
      return run(actor, ref, key, { kind: "retranslate", seen });
    },

    /** The entry's authoritative state: what the browser fetches when it did not see the outcome of a press. */
    state(ref: EntryRef) {
      return lifecycle.entryState(ref);
    },
  };
}

export type AlertSubmitter = ReturnType<typeof createSubmitter>;
