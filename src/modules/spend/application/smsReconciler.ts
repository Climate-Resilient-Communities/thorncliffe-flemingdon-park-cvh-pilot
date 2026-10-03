// The reconciliation of the provider's prices (S06.08, AD-8): what each text message actually cost, from the provider's own listing, set
// against the estimates counted when the texts were accepted. One use case, `reconcile(id)`, for a stable id `month:{YYYY-MM}`:
//  1. the interval is exact (the Toronto calendar month, in UTC) and the month must have ended: a reconciliation is complete for good, so a
//     month still running could never take the messages that are yet to be sent in it;
//  2. a complete reconciliation is not run again (nothing is listed, nothing changes);
//  3. the matching rule is re-run over every unretired estimate first, so an actual imported earlier retires an estimate found later (and
//     `reconcileDue` runs it once at the start of every run, even when every month is complete, so a late provider id whose own matching
//     failed is recovered by the next daily run and not by the next month's reconciliation);
//  4. the provider's Messages API is listed through a port, page after page, following `next_page_uri` until it is empty (smsListing.ts);
//  5. the listing is COMPLETE only when it ended by itself and every outbound message of the interval has a price this app can convert
//     (domain/smsActuals.ts). Otherwise (the listing failed, was cut short, a message has no price yet, a price is unusable, a message is
//     malformed) the reconciliation is PENDING: nothing from the listing is recorded, the interval shows as "pending reconciliation" with
//     its estimates still counted, and the next run tries again from the start;
//  6. a complete listing is applied in ONE transaction that holds the reconciliation's lock: each message's price is recorded once by its
//     MessageSid (one imported by another reconciliation is left as it is), converted to CAD at the configured rate and labelled, the
//     matching rule retires the estimates the new actuals answer for, and the reconciliation is marked complete.
// A run (`reconcileDue`) has ONE time budget for all its months, so it ends inside the job route's limit however many months are due: the
// listing of each month is given the run's deadline, a page is asked for no longer than the time left, and a month whose turn comes after the
// time is spent is cut short (pending, tried again by the next run) without being asked for.
// Twilio is reached only through the `SmsMessageLister` port (a fake in every test; the real adapter is built by messaging and is called
// only by the job that wires it in production). No message's number or body is ever read: the port gives the id, the direction, the instant
// sent and the price.
import type { Db, DbTransaction } from "@/platform/db";
import { monthOf, parseReconciliationId, previousMonth, type MonthKey, type PendingReason, type ReconciliationInterval } from "../domain/reconciliation";
import { toActuals } from "../domain/smsActuals";
import { listMessages, type ListingLimits, type SmsMessageLister } from "./smsListing";
import {
  completeSmsReconciliation,
  importSmsActuals,
  lockSmsReconciliation,
  pendingReconciliationMonths,
  readSmsReconciliation,
  recordPendingReconciliation,
  retireSmsEstimates,
  startSmsReconciliation,
  unreconciledEstimateMonths,
  unretiredSmsEstimateDeliveries,
  type ProviderIdPair,
} from "./smsSpend";

/**
 * Port, implemented by messaging (which owns `delivery`) and wired in the composition root: the provider ids the deliveries carry. The
 * pairs are a delivery and its MessageSid, for those that have one; a delivery with no provider id is simply not in the answer.
 */
export interface DeliveryProviderIds {
  ofDeliveries(tx: DbTransaction, deliveryIds: readonly string[]): Promise<ProviderIdPair[]>;
}

/** Where the spend module reports what it did: structured, one JSON line per event, ids, counts and codes only. */
export interface SpendLog {
  info(evt: string, fields: Record<string, string | number | boolean | null>): void;
  error(evt: string, fields: Record<string, string | number | boolean | null>): void;
}

export interface SmsReconcilerDeps {
  db: Db;
  lister: SmsMessageLister;
  providerIds: DeliveryProviderIds;
  /** CAD per US dollar the actual prices are converted at (SMS_USD_TO_CAD_RATE). */
  usdToCadRate: number;
  now(): Date;
  log: SpendLog;
  /** One run's limits (test seams): the pages each month's listing will read and how long the whole run will list for. Defaults: 200 pages of up to 1,000 messages, 45 seconds. */
  limits?: Partial<ListingLimits>;
}

export const DEFAULT_MAX_PAGES = 200;
/** The job route lives 60 seconds (maxDuration): the listing stops well before that, so the import that follows it has its time. */
export const DEFAULT_LISTING_DEADLINE_MS = 45_000;

export type ReconcileResult =
  | { status: "refused"; reason: "id_invalid" }
  | { status: "not_ended"; endsAt: string }
  | { status: "already_complete" }
  | { status: "pending"; reason: PendingReason }
  | {
      status: "complete";
      /** Outbound messages the provider listed in the interval. */
      messages: number;
      /** Those this reconciliation recorded (the rest were already imported by another reconciliation). */
      imported: number;
      alreadyImported: number;
      /** Listed but sent outside the exact interval (the provider's date filter is wider): left to the reconciliation whose interval they are in. */
      outsideInterval: number;
      /** Estimates retired by the matching rule before the listing (an actual imported earlier, an estimate found later). */
      rematched: number;
      /** Estimates retired by the actuals this reconciliation imported. */
      retired: number;
    }
  | { status: "failed"; error: string };

const nameOf = (error: unknown) => (error instanceof Error ? error.name : "NonError");

export interface SmsReconciler {
  /** Reconciles one month by its id (`month:{YYYY-MM}`). Never throws for a listing that fails: that is a pending reconciliation. */
  reconcile(id: string): Promise<ReconcileResult>;
  /**
   * What is due: the month before this one, every month whose reconciliation is still pending and every ended month with text message
   * estimates and no complete reconciliation (one the job never reached), or the months asked for, oldest first. The matching rule runs once
   * first over every unretired estimate. One month failing (a database error) never stops the others; it is reported as `failed`. The
   * months share one time budget (`limits.deadlineMs`).
   */
  reconcileDue(months?: readonly MonthKey[]): Promise<{ id: string; result: ReconcileResult }[]>;
}

/** The matching rule over every unretired estimate: each is retired by the imported actual whose MessageSid is its delivery's provider id. Returns how many it retired. */
export async function matchUnretiredEstimates(tx: DbTransaction, providerIds: DeliveryProviderIds): Promise<number> {
  let after: string | null = null;
  let retired = 0;
  for (;;) {
    const page: string[] = await unretiredSmsEstimateDeliveries(tx, { after, limit: 500 });
    if (page.length === 0) return retired;
    retired += await retireSmsEstimates(tx, await providerIds.ofDeliveries(tx, page));
    after = page[page.length - 1] ?? null;
  }
}

export function createSmsReconciler(deps: SmsReconcilerDeps): SmsReconciler {
  const { db, lister, providerIds, usdToCadRate, log } = deps;
  const limits: ListingLimits = { maxPages: deps.limits?.maxPages ?? DEFAULT_MAX_PAGES, deadlineMs: deps.limits?.deadlineMs ?? DEFAULT_LISTING_DEADLINE_MS };

  async function pending(interval: ReconciliationInterval, reason: PendingReason): Promise<ReconcileResult> {
    await recordPendingReconciliation(db, { interval, reason, at: deps.now() });
    log.error("reconcile.pending", { reconciliation: interval.id, reason });
    return { status: "pending", reason };
  }

  async function reconcileBy(id: string, deadlineAt: Date): Promise<ReconcileResult> {
    const interval = parseReconciliationId(id);
    if (!interval) return { status: "refused", reason: "id_invalid" };
    if (deps.now() < interval.endUtc) {
      log.info("reconcile.not_ended", { reconciliation: id });
      return { status: "not_ended", endsAt: interval.endUtc.toISOString() };
    }
    if ((await readSmsReconciliation(db, id))?.state === "complete") return { status: "already_complete" };

    // The matching rule first, over every unretired estimate: an actual imported earlier retires an estimate that is found only now.
    const rematched = await db.transaction((tx) => matchUnretiredEstimates(tx, providerIds));

    const listing = await listMessages(lister, interval, {
      now: deps.now,
      limits,
      deadlineAt,
      onFailure: ({ reason, page, error }) => log.error(`reconcile.${reason}`, { reconciliation: id, page, error }),
    });
    if (listing.kind === "pending") return pending(interval, listing.reason);
    const converted = toActuals(interval, listing.messages, usdToCadRate);
    if (converted.kind === "pending") {
      log.error("reconcile.not_applicable", { reconciliation: id, reason: converted.reason });
      return pending(interval, converted.reason);
    }

    // One transaction: the lock, the actuals, the matching rule and the completion, or none of them.
    const at = deps.now();
    const applied = await db.transaction(async (tx) => {
      await lockSmsReconciliation(tx, id);
      if (!(await startSmsReconciliation(tx, { interval, at }))) return null;
      const imported = await importSmsActuals(tx, id, converted.actuals);
      const retired = await matchUnretiredEstimates(tx, providerIds);
      await completeSmsReconciliation(tx, { id, messages: converted.actuals.length, imported: imported.length, usdToCadRate, at });
      return { imported: imported.length, retired };
    });
    // Another run of the same reconciliation completed it while this one listed: nothing is changed twice.
    if (applied === null) return { status: "already_complete" };

    const result: ReconcileResult = {
      status: "complete",
      messages: converted.actuals.length,
      imported: applied.imported,
      alreadyImported: converted.actuals.length - applied.imported,
      outsideInterval: converted.outsideInterval,
      rematched,
      retired: applied.retired,
    };
    log.info("reconcile.complete", { reconciliation: id, messages: result.messages, imported: result.imported, outside_interval: result.outsideInterval, rematched, retired: result.retired });
    return result;
  }

  const deadlineFrom = (start: Date) => new Date(start.getTime() + limits.deadlineMs);

  async function reconcile(id: string): Promise<ReconcileResult> {
    return reconcileBy(id, deadlineFrom(deps.now()));
  }

  /** The months a run reconciles when it is not told which: the one before this, those still pending and those with estimates that no complete reconciliation covers. */
  async function dueMonths(): Promise<MonthKey[]> {
    const current = monthOf(deps.now());
    const ended = (await unreconciledEstimateMonths(db)).filter((month) => month < current);
    return [...new Set([previousMonth(current), ...(await pendingReconciliationMonths(db)), ...ended])].sort();
  }

  async function reconcileDue(months?: readonly MonthKey[]) {
    // One budget for the whole run, from its start.
    const deadlineAt = deadlineFrom(deps.now());
    // The matching rule once, whatever is due: a reconciliation that is already complete never runs it, and a late provider id whose own
    // matching failed (or an estimate and an actual committed at the same moment) would otherwise wait for the next month's reconciliation.
    // A failure here costs only this recovery, so it is logged and the months are still reconciled; the next run tries again.
    try {
      const rematched = await db.transaction((tx) => matchUnretiredEstimates(tx, providerIds));
      if (rematched > 0) log.info("reconcile.rematched", { retired: rematched });
    } catch (error) {
      log.error("reconcile.match_failed", { error: nameOf(error) });
    }
    const wanted = months ?? (await dueMonths());
    const results: { id: string; result: ReconcileResult }[] = [];
    for (const month of wanted) {
      const id = `month:${month}`;
      try {
        results.push({ id, result: await reconcileBy(id, deadlineAt) });
      } catch (error) {
        log.error("reconcile.failed", { reconciliation: id, error: nameOf(error) });
        results.push({ id, result: { status: "failed", error: nameOf(error) } });
      }
    }
    return results;
  }

  return { reconcile, reconcileDue };
}
