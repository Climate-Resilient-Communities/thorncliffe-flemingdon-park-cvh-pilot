// The sender (S06.02, AD-8): one dispatcher submits each text at most once, in claim order, at a shared pace. A run
//  1. takes the sender lease (a conditional update, only when the previous lease expired) or exits without claiming anything;
//  2. returns the rows an earlier lease holder claimed and never handed off, and sweeps the expired claims (5 minutes without a
//     hand-off: back to `queued`; handed off with no outcome for 5 minutes, or `submitted` for 24 hours: `unknown`, recorded
//     in ops_event, never sent again). Each `unknown` is settled in a transaction of its own, and a failure of the upkeep is
//     logged and never stops the sending that follows: a row that cannot be settled is left for the next run;
//  3. claims a few rows at a time in claim order (`FOR UPDATE SKIP LOCKED`, `claimed` with the worker and the lease token in its
//     own short transaction), never more than it can send at the pace before its time limit less a margin;
//  4. for each row passes the hand-off point: ONE short transaction that locks the delivery row `FOR UPDATE`, checks this
//     worker's lease token, re-reads the pause, the entry and thread, the `send_by` and the recipient (asking the
//     ContactResolver for the number inside the transaction, and never storing it), and commits `handed_off_at` only if the
//     row is still sendable. A change that must stop a send writes the delivery rows itself under the same row lock, so it
//     either commits first (the row is `cancelled` or `skipped`, nothing is called) or waits for the hand-off to commit (the
//     text is in flight and cannot be recalled);
//  5. only after that commit calls the provider through the Messaging Service, once, and records the outcome: `submitted` with the
//     provider's id; not accepted (HTTP 429 with an error body, or a connection that failed before the request was sent) back to
//     `queued` with backoff, at most 3 times and then `failed`; a permanent error `failed`; anything else `unknown`. The outcome
//     is written only while the row is still `claimed` by this token, so a late response never overwrites a callback's state.
//  6. gives the lease up and looks once more: a kick that found the lease held (while this run made its last, empty claim) exited
//     without claiming, so if anything is due the holder takes the lease again for one more pass.
//
// The guarantee is no automatic duplicate submission, not exactly-once delivery: a text is handed to the provider at most once,
// and a text whose outcome is unclear is `unknown` and never sent again. Under `SMS_MODE=log` nothing is sent and no credential
// is read: each row that is sendable becomes `skipped_env`. The number lives in one local variable, from the resolver's answer
// to the provider call; no log line, outcome or error here ever holds it.
import { randomBytes } from "node:crypto";
import {
  CLAIM_BATCH_ROWS,
  DEFAULT_SEGMENTS_PER_SECOND,
  LEASE_RENEW_AFTER_MS,
  LEASE_TTL_MS,
  RUN_LIMIT_MS,
  RUN_MARGIN_MS,
  SWEEP_BATCH_ROWS,
  alertNotSendable,
  authFailureStopsRun,
  capacitySegments,
  classifyAnswer,
  createPaceLimiter,
  isAuthFailure,
  pauseApplies,
  statusCallbackUrl,
  type SubmitAnswer,
  type SubmitOutcome,
} from "../domain/dispatchRules";
import { ContactNumberInvalid } from "./contactResolver";
import type { DeliveryView, ResolvedContact } from "./deliveryPorts";
import { CampaignReaderNotWired, type DispatchReport, type Dispatcher, type DispatcherDeps, type StopReason, type StoppedState } from "./dispatcherPorts";

/** What the hand-off transaction decided; the number, when there is one, is held only by this value until the provider call. */
type HandOff =
  | { kind: "handed_off"; number: string }
  | { kind: "stopped"; to: StoppedState; reason: StopReason }
  /** The row is no longer this run's claim (a cancellation, a deletion, a replacement lease holder or a callback moved it): nothing to do. */
  | { kind: "not_mine" }
  | { kind: "lease_lost" };

const emptyReport = (): DispatchReport => ({
  status: "ok",
  claimed: 0,
  handedOff: 0,
  submitted: 0,
  requeued: 0,
  failed: 0,
  unknown: 0,
  skippedEnv: 0,
  stopped: 0,
  segments: 0,
  sweep: { requeued: 0, unknown: 0, failed: 0 },
});

/** An error's name only: its message could quote data, and a log line must not. */
const nameOf = (error: unknown) => (error instanceof Error ? error.name : "NonError");

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const { db, store, resolver, alerts, ops, log, clock, config } = deps;
  const rate = deps.segmentsPerSecond ?? DEFAULT_SEGMENTS_PER_SECOND;
  const runLimitMs = deps.runLimitMs ?? RUN_LIMIT_MS;
  const marginMs = deps.marginMs ?? RUN_MARGIN_MS;
  const batchRows = deps.batchRows ?? CLAIM_BATCH_ROWS;
  const renewAfterMs = deps.leaseRenewAfterMs ?? LEASE_RENEW_AFTER_MS;
  const newWorkerId = deps.workerId ?? (() => `dispatch-${randomBytes(4).toString("hex")}`);

  async function run(): Promise<DispatchReport> {
    const report = emptyReport();
    const startedAt = clock.now().getTime();
    // The last instant at which a send may start: the run's limit less the margin.
    const sendUntil = startedAt + runLimitMs - marginMs;
    const workerId = newWorkerId();

    const idle = await pass(report, { workerId, sendUntil, first: true });
    // A kick that arrived while that pass still held the lease (on its last, empty claim) exited without claiming, and the rows it was
    // started for would wait for the next pg_cron run. So once the lease is given up, a holder whose queue ran dry looks once more, and
    // takes the lease again if anything is due. (One more pass at most, and none after a pass that ended for another reason: a pause,
    // the end of its time, a lost lease, refused credentials, or a row it could not hand off, which is not tried again and again.)
    if (idle && report.status === "ok" && clock.now().getTime() < sendUntil) {
      const due = await store.hasDueRows(db, { skewMs: clock.skewMs() }).catch((error: unknown) => {
        log.error("dispatch.due_check_failed", { error: nameOf(error) });
        return false;
      });
      if (due) await pass(report, { workerId, sendUntil, first: false });
    }
    if (report.status !== "lease_held") {
      log.info("dispatch.run_finished", {
        worker: workerId,
        status: report.status,
        claimed: report.claimed,
        handed_off: report.handedOff,
        submitted: report.submitted,
        requeued: report.requeued,
        failed: report.failed,
        unknown: report.unknown,
        skipped_env: report.skippedEnv,
        stopped: report.stopped,
        segments: report.segments,
      });
    }
    return report;
  }

  /**
   * One holding of the lease, from taking it to giving it up. The first pass of a run also sweeps; the report is the run's. Returns
   * whether the pass ended because its claim found the queue empty (and no hand-off failed), the one end after which another look is worth it.
   */
  async function pass(report: DispatchReport, { workerId, sendUntil, first }: { workerId: string; sendUntil: number; first: boolean }): Promise<boolean> {
    const lease = await store.acquireLease(db, { holder: workerId, ttlMs: LEASE_TTL_MS, skewMs: clock.skewMs() });
    if (!lease) {
      // Another dispatcher sends: this run claims nothing. (After a first pass, another holder has taken over: it sends what is due.)
      if (first) {
        report.status = "lease_held";
        log.info("dispatch.lease_held", { worker: workerId });
      }
      return false;
    }
    const { token } = lease;
    const limiter = createPaceLimiter(rate, clock.now().getTime(), lease.paceBarrierMs);
    let renewedAt = clock.now().getTime();
    let authFailures = 0;
    let handOffFailures = 0;
    let queueRanDry = false;

    /** Renews the lease when it is due; false means it was lost and the run must stop at once, without calling the provider. */
    async function renewIfDue(): Promise<boolean> {
      const now = clock.now().getTime();
      if (now - renewedAt < renewAfterMs) return true;
      const kept = await store.renewLease(db, { token, ttlMs: LEASE_TTL_MS, skewMs: clock.skewMs(), paceDebtMs: limiter.debtMs(now) });
      if (kept) renewedAt = now;
      return kept;
    }

    /** Passes the hand-off point for one claimed row (see the header). */
    function handOffPoint(row: DeliveryView): Promise<HandOff> {
      const skewMs = clock.skewMs();
      return db.transaction(async (tx): Promise<HandOff> => {
        // 1. The delivery row first, locked: whatever must stop this send writes this row, so it is either already written or waits.
        const locked = await store.lockForHandOff(tx, row.id, skewMs);
        if (!locked) return { kind: "not_mine" };
        const current = locked.row;
        if (current.state !== "claimed" || current.claimToken !== token || current.handedOffAt !== null) return { kind: "not_mine" };
        // 2. This worker's lease token, still current and unexpired.
        if (!(await store.leaseHeld(tx, token, skewMs))) return { kind: "lease_lost" };

        const stop = async (to: StoppedState, reason: StopReason, errorCode?: number | null): Promise<HandOff> =>
          (await store.stopBeforeHandOff(tx, { id: current.id, token, to, errorCode })) ? { kind: "stopped", to, reason } : { kind: "not_mine" };

        // 3. The pause, re-read: the row waits in the queue (no attempt counted).
        if (pauseApplies(current) && (await store.isPaused(tx))) return stop("queued", "paused");
        // 4. Too late for the text to mean anything.
        if (locked.sendByPassed) return stop("skipped", "send_by_passed");
        // 5. The entry and its thread (alerts), or the campaign.
        if (current.kind === "alert") {
          // The valid-until is judged by the database's clock, as the lease, the send-by and every claim's age are (skew: see DispatcherClock).
          const standing = await alerts.standingOf(tx, current.entryId ?? "", skewMs);
          const refusal = alertNotSendable(standing, current.recipientKind);
          if (refusal) return stop(refusal.outcome, refusal.reason);
        } else if (current.kind === "campaign") {
          if (!deps.campaigns) throw new CampaignReaderNotWired();
          const sendable = await deps.campaigns.sendable(tx, { campaignId: current.campaignId ?? "", recipientId: current.recipientId });
          if (!sendable) return stop("skipped", "campaign_not_sendable");
        }
        // 6. SMS_MODE=log: nothing is sent, no number is asked for, and no credential is read.
        if (config.mode === "log") return stop("skipped_env", "sms_mode_log");
        // 7. The recipient, still eligible, and the number, in memory only. The row's recipient was read above, before this call,
        //    because taking an `inbound_reply` number deletes its row and the delivery's own trigger then forgets the recipient.
        let contact: ResolvedContact;
        try {
          contact = await resolver.resolve(tx, { deliveryId: current.id, kind: current.recipientKind, id: current.recipientId, deliveryKind: current.kind, purpose: current.purpose });
        } catch (error) {
          if (error instanceof ContactNumberInvalid) return stop("failed", "number_invalid");
          throw error;
        }
        if (!contact.found) return stop("skipped", "recipient_gone");
        // 8. The hand-off itself, committed with this transaction.
        if (!(await store.markHandedOff(tx, { id: current.id, token }))) throw new Error("The hand-off found the row it holds locked no longer claimed");
        return { kind: "handed_off", number: contact.number };
      });
    }

    /** Writes the provider's outcome only while the row is still this token's claim; otherwise only fills a missing provider id. */
    async function recordOutcome(row: DeliveryView, outcome: SubmitOutcome): Promise<void> {
      const skewMs = clock.skewMs();
      const applied = await db.transaction(async (tx) => {
        const written = await store.recordOutcome(tx, { id: row.id, token, outcome, skewMs });
        if (!written) {
          // A callback (or the sweep) already moved the row: what it wrote stands.
          if (outcome.kind === "submitted") {
            const filled = await store.fillProviderId(tx, { id: row.id, token, providerMessageId: outcome.providerMessageId });
            if (filled === "different") log.error("dispatch.provider_id_differs", { delivery_id: row.id });
          }
          log.info("dispatch.outcome_not_applied", { delivery_id: row.id, outcome: outcome.kind });
          return false;
        }
        if (outcome.kind === "unknown") {
          await ops.record(tx, { kind: "delivery.unknown", deliveryId: row.id, detail: outcome.httpStatus === null ? { cause: outcome.cause } : { cause: outcome.cause, http_status: outcome.httpStatus } });
        }
        if (outcome.kind === "submitted" || outcome.kind === "unknown") await deps.afterOutcome?.(tx, row, outcome.kind);
        return true;
      });
      if (!applied) return;
      if (outcome.kind === "submitted") report.submitted += 1;
      else if (outcome.kind === "requeue") report.requeued += 1;
      else if (outcome.kind === "failed") report.failed += 1;
      else report.unknown += 1;
    }

    /** Hands one row off and submits it. Returns what the batch should do next. */
    async function sendOne(row: DeliveryView): Promise<"next" | "end_batch" | "stop"> {
      let handOff: HandOff;
      try {
        handOff = await handOffPoint(row);
      } catch (error) {
        // The transaction rolled back: the row is still this token's claim, not handed off, and goes back at the end of the batch.
        log.error("dispatch.hand_off_failed", { delivery_id: row.id, error: nameOf(error) });
        handOffFailures += 1;
        return "next";
      }
      if (handOff.kind === "lease_lost") {
        report.status = "lease_lost";
        return "stop";
      }
      if (handOff.kind === "not_mine") return "next";
      if (handOff.kind === "stopped") {
        report.stopped += handOff.to === "skipped_env" ? 0 : 1;
        if (handOff.to === "skipped_env") {
          report.skippedEnv += 1;
          log.info("dispatch.skipped_env", { delivery_id: row.id, body_length: [...row.body].length, segments: row.segments });
        } else {
          log.info("dispatch.not_sent", { delivery_id: row.id, becomes: handOff.to, reason: handOff.reason });
        }
        // A pause stops every row of the batch the same way: put the rest back instead of asking each one.
        return handOff.reason === "paused" ? "end_batch" : "next";
      }

      // Committed: the text is in flight. Nothing below may send it a second time.
      if (config.mode !== "live") throw new Error("A hand-off committed with no provider to send to");
      report.handedOff += 1;
      report.segments += row.segments;
      limiter.record(clock.now().getTime(), row.segments);
      let answer: SubmitAnswer | undefined;
      let outcome: SubmitOutcome;
      try {
        answer = await config.submitter.submit({
          to: handOff.number,
          body: row.body,
          messagingServiceSid: config.messagingServiceSid,
          statusCallback: statusCallbackUrl(config.publicBaseUrl, row.callbackRef),
        });
        outcome = classifyAnswer(answer, row.attempts);
      } catch (error) {
        // Anything that went wrong after the request may have been sent is unclear: the row is `unknown`, never sent again.
        log.error("dispatch.provider_threw", { delivery_id: row.id, error: nameOf(error) });
        outcome = { kind: "unknown", cause: "provider_threw", httpStatus: null };
      }
      try {
        await recordOutcome(row, outcome);
      } catch (error) {
        // The provider answered and the answer could not be written: the row stays handed off with no outcome, and the sweep
        // makes it `unknown` after 5 minutes. It is never queued again.
        log.error("dispatch.outcome_unrecorded", { delivery_id: row.id, outcome: outcome.kind, error: nameOf(error) });
      }
      authFailures = answer && isAuthFailure(answer) ? authFailures + 1 : 0;
      if (answer?.kind === "rejected" && authFailureStopsRun(answer, authFailures)) {
        // Wrong credentials fail every text for good: stop at the first 401 (a few 403s) instead of failing the whole queue.
        report.status = "provider_auth_failed";
        log.error("dispatch.provider_auth_failed", { http_status: answer.httpStatus });
        await ops.record(db, { kind: "dispatch.provider_auth_failed", detail: { http_status: answer.httpStatus } }).catch((error: unknown) => log.error("dispatch.ops_event_failed", { error: nameOf(error) }));
        return "stop";
      }
      return "next";
    }

    /** The upkeep before sending. It is never allowed to stop the sending: a failure is logged (the error's name only) and the run goes on to claim. */
    async function upkeep(): Promise<void> {
      try {
        await store.requeueOrphans(db, { token, skewMs: clock.skewMs() });
      } catch (error) {
        log.error("dispatch.sweep_failed", { step: "requeue_orphans", error: nameOf(error) });
      }
      try {
        const afterOutcome = deps.afterOutcome;
        const swept = await store.sweep(db, {
          skewMs: clock.skewMs(),
          maxRows: SWEEP_BATCH_ROWS,
          // Written in the transaction that makes the row `unknown`, so none goes unseen; if it cannot be written, that row alone is left for the next run.
          recordUnknown: async (tx, unknownRow, cause) => {
            await ops.record(tx, { kind: "delivery.unknown", deliveryId: unknownRow.id, detail: { cause } });
          },
          // A text handed off with no outcome may have been charged, so the spend estimate is counted now, with the outcome; one that was
          // already `submitted` was counted when the provider accepted it (never twice). The store runs this in a savepoint: if it fails, the
          // row is still `unknown` with its event (the failure is logged), so a failing hook never stops the queue.
          afterUnknown: afterOutcome
            ? async (tx, unknownRow, cause) => {
                if (cause === "no_outcome_after_hand_off") await afterOutcome(tx, unknownRow, "unknown");
              }
            : undefined,
        });
        report.sweep = { requeued: swept.requeued, unknown: swept.unknown.length, failed: swept.failed.length };
        for (const failure of swept.failed) log.error("dispatch.sweep_row_failed", { delivery_id: failure.id, cause: failure.cause, error: failure.error });
        for (const failure of swept.hookFailed) log.error("dispatch.sweep_spend_hook_failed", { delivery_id: failure.id, error: failure.error });
      } catch (error) {
        log.error("dispatch.sweep_failed", { step: "sweep", error: nameOf(error) });
      }
    }

    try {
      if (first) await upkeep();

      for (;;) {
        const remainingMs = sendUntil - clock.now().getTime();
        if (remainingMs <= 0) break;
        if (!(await renewIfDue())) {
          report.status = "lease_lost";
          break;
        }
        // The rows an old holder claimed after its lease went are put back before this holder looks at the queue.
        await store.requeueOrphans(db, { token, skewMs: clock.skewMs() });
        const capacity = config.mode === "live" ? capacitySegments(remainingMs, rate) : Number.MAX_SAFE_INTEGER;
        if (capacity < 1) break;
        const claim = await store.claim(db, { token, workerId, skewMs: clock.skewMs(), maxRows: batchRows, maxSegments: capacity });
        if (claim.kind === "lease_lost") {
          report.status = "lease_lost";
          break;
        }
        if (claim.rows.length === 0) {
          queueRanDry = true;
          break;
        }
        report.claimed += claim.rows.length;

        let next: "next" | "end_batch" | "stop" = "next";
        for (const row of claim.rows) {
          if (config.mode === "live") {
            // The pace is kept before the hand-off, so a row is not held handed-off while it waits for its turn.
            const waitMs = limiter.waitMs(clock.now().getTime(), row.segments);
            if (waitMs > 0) await clock.sleep(waitMs);
          }
          if (clock.now().getTime() > sendUntil) {
            next = "end_batch";
            break;
          }
          if (!(await renewIfDue())) {
            report.status = "lease_lost";
            next = "stop";
            break;
          }
          next = await sendOne(row);
          if (next !== "next") break;
        }
        if (next !== "next") {
          // The batch ended early (a pause, the end of the run's time, a lost lease): what was claimed and not handed off goes back at
          // once, with no attempt counted, so another run can take it. A row whose hand-off failed stays claimed until the run ends, so
          // this run does not claim it again and again.
          await store.releaseClaims(db, { token });
          if (next === "stop") break;
        }
      }
    } finally {
      // Never leave claimed rows or a held lease behind, whatever ended the run (an error included).
      const now = clock.now().getTime();
      await store.releaseClaims(db, { token }).catch((error: unknown) => log.error("dispatch.release_claims_failed", { error: nameOf(error) }));
      await store
        .releaseLease(db, { token, skewMs: clock.skewMs(), paceDebtMs: limiter.debtMs(now) })
        .catch((error: unknown) => log.error("dispatch.release_lease_failed", { error: nameOf(error) }));
    }
    return queueRanDry && handOffFailures === 0;
  }

  return { run };
}
