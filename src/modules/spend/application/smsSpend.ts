// The spend module's records of text messages (S06.08, AD-8): an estimate per delivery, the actual prices a reconciliation imports, and which
// actual retired which estimate. Every function runs with the executor it is given (the caller's transaction, when it has one) and writes
// only the spend module's own tables. The tables' constraints are the last line: an estimate is written once per delivery, an actual once per
// MessageSid, an estimate is retired at most once and an actual retires at most one estimate.
import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { DbExecutor, DbTransaction } from "@/platform/db";
import { smsActual, smsReconciliation, spendEvent } from "../adapters/schema";
import { TORONTO, monthInterval, type MonthKey, type PendingReason, type ReconciliationInterval } from "../domain/reconciliation";
import type { ActualInput } from "../domain/smsActuals";
import { SMS_KIND, SMS_MODEL, toSmsEstimate, type SmsEstimateInput } from "../domain/smsEstimate";
import { buildMonthReport, type MonthFigures, type SmsMonthReport } from "../domain/smsReport";

/** Pairs written or read at a time: each is two bound values, far below the driver's limit. */
const CHUNK = 500;

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}

/**
 * Writes a text message's estimate: kind `sms`, once per delivery. Returns whether this call wrote it (false: the delivery already has
 * its estimate, so nothing changes and the text is still counted once). Throws on an invalid estimate or a failed insert.
 */
export async function recordSmsEstimate(executor: DbExecutor, input: SmsEstimateInput): Promise<{ recorded: boolean }> {
  const estimate = toSmsEstimate(input);
  const written = await executor
    .insert(spendEvent)
    .values({
      ...(estimate.at === undefined ? {} : { at: estimate.at }),
      kind: SMS_KIND,
      purpose: estimate.purpose,
      model: SMS_MODEL,
      deliveryId: estimate.deliveryId,
      lang: estimate.lang,
      entryId: estimate.entryId,
      isDrill: estimate.isDrill,
      segments: estimate.segments,
      costEstimateCents: estimate.costCents,
    })
    .onConflictDoNothing({ target: spendEvent.deliveryId, where: isNotNull(spendEvent.deliveryId) })
    .returning({ id: spendEvent.id });
  return { recorded: written.length === 1 };
}

/** A delivery and the MessageSid it carries (the provider's id for the text). */
export interface ProviderIdPair {
  deliveryId: string;
  messageSid: string;
}

/**
 * The matching rule, one step: every estimate whose delivery is named in `pairs` is retired by the imported actual whose MessageSid is the
 * delivery's provider id, whatever month either falls in. An estimate that is already retired, an actual that already retired another
 * estimate and a pair with no estimate or no imported actual are left as they are (the constraints refuse a second retirement, and the
 * statement skips it). Returns how many estimates it retired.
 */
export async function retireSmsEstimates(executor: DbExecutor, pairs: readonly ProviderIdPair[]): Promise<number> {
  let retired = 0;
  for (const part of chunks(pairs)) {
    if (part.length === 0) continue;
    const values = sql.join(
      part.map((pair) => sql`(${pair.deliveryId}::uuid, ${pair.messageSid}::text)`),
      sql`, `,
    );
    const rows = await executor.execute<{ estimate_id: string }>(sql`
      insert into sms_estimate_retirement (estimate_id, message_sid)
      select e.id, p.message_sid
      from (values ${values}) as p (delivery_id, message_sid)
      join spend_event e on e.kind = ${SMS_KIND} and e.delivery_id = p.delivery_id
      join sms_actual a on a.message_sid = p.message_sid
      on conflict do nothing
      returning estimate_id`);
    retired += rows.length;
  }
  return retired;
}

/** The deliveries whose estimates no actual has retired, in id order after `after`, at most `limit` of them (for the matching rule to read their provider ids). */
export async function unretiredSmsEstimateDeliveries(executor: DbExecutor, options: { after?: string | null; limit?: number } = {}): Promise<string[]> {
  const rows = await executor
    .select({ deliveryId: spendEvent.deliveryId })
    .from(spendEvent)
    .where(
      and(
        eq(spendEvent.kind, SMS_KIND),
        options.after ? gt(spendEvent.deliveryId, options.after) : undefined,
        sql`not exists (select 1 from sms_estimate_retirement r where r.estimate_id = ${spendEvent.id})`,
      ),
    )
    .orderBy(asc(spendEvent.deliveryId))
    .limit(options.limit ?? CHUNK);
  return rows.flatMap((row) => (row.deliveryId === null ? [] : [row.deliveryId]));
}

// --- reconciliations ---------------------------------------------------------------------------------------------------

export interface ReconciliationRow {
  id: string;
  state: "pending" | "complete";
  pendingReason: PendingReason | null;
  attempts: number;
  lastAttemptAt: Date | null;
  usdToCadRate: number | null;
  messages: number | null;
  imported: number | null;
  completedAt: Date | null;
}

const rowOf = (row: typeof smsReconciliation.$inferSelect): ReconciliationRow => ({
  id: row.id,
  state: row.state as ReconciliationRow["state"],
  pendingReason: row.pendingReason as PendingReason | null,
  attempts: row.attempts,
  lastAttemptAt: row.lastAttemptAt,
  usdToCadRate: row.usdToCadRate === null ? null : Number(row.usdToCadRate),
  messages: row.messages,
  imported: row.imported,
  completedAt: row.completedAt,
});

export async function readSmsReconciliation(executor: DbExecutor, id: string): Promise<ReconciliationRow | null> {
  const [row] = await executor.select().from(smsReconciliation).where(eq(smsReconciliation.id, id));
  return row ? rowOf(row) : null;
}

/** The months with a reconciliation that is not complete (they are tried again on the next run). */
export async function pendingReconciliationMonths(executor: DbExecutor): Promise<MonthKey[]> {
  const rows = await executor.select({ id: smsReconciliation.id }).from(smsReconciliation).where(eq(smsReconciliation.state, "pending")).orderBy(asc(smsReconciliation.id));
  return rows.map((row) => row.id.slice("month:".length));
}

/**
 * The Toronto months in which a text message's estimate was made and that have no complete reconciliation, oldest first: a month the daily
 * job never reached (it did not run, or ran too late to be the month before) shows as "pending reconciliation (not_run)" until it is
 * reconciled, so it is due as much as a month with a pending row. The caller leaves out the month that has not ended.
 */
export async function unreconciledEstimateMonths(executor: DbExecutor): Promise<MonthKey[]> {
  const rows = await executor.execute<{ month: string }>(sql`
    select distinct to_char(e.at at time zone ${TORONTO}::text, 'YYYY-MM') as month
    from spend_event e
    where e.kind = ${SMS_KIND}
      and not exists (
        select 1 from sms_reconciliation r
        where r.state = 'complete' and r.id = 'month:' || to_char(e.at at time zone ${TORONTO}::text, 'YYYY-MM'))
    order by 1`);
  return rows.map((row) => row.month);
}

/** Records an attempt that did not complete: the reason and one more attempt, nothing else. A complete reconciliation is left as it is (returns false). */
export async function recordPendingReconciliation(executor: DbExecutor, input: { interval: ReconciliationInterval; reason: PendingReason; at: Date }): Promise<boolean> {
  const written = await executor
    .insert(smsReconciliation)
    .values({ id: input.interval.id, intervalStart: input.interval.startUtc, intervalEnd: input.interval.endUtc, state: "pending", pendingReason: input.reason, attempts: 1, lastAttemptAt: input.at })
    .onConflictDoUpdate({
      target: smsReconciliation.id,
      set: { pendingReason: input.reason, attempts: sql`${smsReconciliation.attempts} + 1`, lastAttemptAt: input.at },
      setWhere: eq(smsReconciliation.state, "pending"),
    })
    .returning({ id: smsReconciliation.id });
  return written.length === 1;
}

/** Serialises two runs of the same reconciliation (the advisory lock lasts until the transaction ends). */
export async function lockSmsReconciliation(tx: DbTransaction, id: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`sms_reconciliation:${id}`}, 0))`);
}

/** Makes sure the reconciliation's row exists and is pending (a transaction that imports its actuals starts here); false when it is already complete. */
export async function startSmsReconciliation(tx: DbTransaction, input: { interval: ReconciliationInterval; at: Date }): Promise<boolean> {
  await tx
    .insert(smsReconciliation)
    .values({ id: input.interval.id, intervalStart: input.interval.startUtc, intervalEnd: input.interval.endUtc, state: "pending", attempts: 0 })
    .onConflictDoNothing({ target: smsReconciliation.id });
  const row = await readSmsReconciliation(tx, input.interval.id);
  return row !== null && row.state === "pending";
}

/**
 * Imports actual prices for a pending reconciliation: each MessageSid once across every reconciliation (one already imported, by this
 * reconciliation or another, is left as it is). Returns the MessageSids this call imported.
 */
export async function importSmsActuals(tx: DbTransaction, reconciliationId: string, actuals: readonly ActualInput[]): Promise<string[]> {
  const imported: string[] = [];
  for (const part of chunks(actuals)) {
    if (part.length === 0) continue;
    const rows = await tx
      .insert(smsActual)
      .values(
        part.map((actual) => ({
          messageSid: actual.messageSid,
          reconciliationId,
          sentAt: actual.sentAt,
          priceText: actual.priceText,
          priceUnit: actual.priceUnit,
          rate: String(actual.rate),
          cadMillicents: actual.cadMillicents,
        })),
      )
      .onConflictDoNothing({ target: smsActual.messageSid })
      .returning({ messageSid: smsActual.messageSid });
    imported.push(...rows.map((row) => row.messageSid));
  }
  return imported;
}

/** Marks a pending reconciliation complete, with what it listed and imported and the rate it converted at. */
export async function completeSmsReconciliation(tx: DbTransaction, input: { id: string; messages: number; imported: number; usdToCadRate: number; at: Date }): Promise<void> {
  const done = await tx
    .update(smsReconciliation)
    .set({
      state: "complete",
      pendingReason: null,
      attempts: sql`${smsReconciliation.attempts} + 1`,
      lastAttemptAt: input.at,
      usdToCadRate: String(input.usdToCadRate),
      messages: input.messages,
      imported: input.imported,
      completedAt: input.at,
    })
    .where(and(eq(smsReconciliation.id, input.id), eq(smsReconciliation.state, "pending")))
    .returning({ id: smsReconciliation.id });
  if (done.length !== 1) throw new Error("The reconciliation to complete is not pending");
}

// --- the report --------------------------------------------------------------------------------------------------------

const num = (value: unknown): number => Number(value ?? 0);

/** What the database adds up for one month (see MonthFigures). */
export async function smsMonthFigures(executor: DbExecutor, month: MonthKey): Promise<MonthFigures> {
  const interval = monthInterval(month);
  const reconciliation = await readSmsReconciliation(executor, interval.id);

  const [actuals] = await executor.execute<{ count: string; millicents: string }>(sql`
    select count(*)::text as count, coalesce(sum(cad_millicents), 0)::text as millicents
    from sms_actual where reconciliation_id = ${interval.id}`);
  const [matched] = await executor.execute<{ count: string; actual_millicents: string; estimate_cents: string }>(sql`
    select count(*)::text as count, coalesce(sum(a.cad_millicents), 0)::text as actual_millicents, coalesce(sum(e.cost_estimate_cents), 0)::text as estimate_cents
    from sms_actual a
    join sms_estimate_retirement r on r.message_sid = a.message_sid
    join spend_event e on e.id = r.estimate_id
    where a.reconciliation_id = ${interval.id}`);
  // The estimates made in the month (by when they were made, in the month's exact UTC interval) that no actual has retired.
  const [unresolved] = await executor.execute<{ count: string; cents: string }>(sql`
    select count(*)::text as count, coalesce(sum(e.cost_estimate_cents), 0)::text as cents
    from spend_event e
    where e.kind = ${SMS_KIND}
      and e.at >= ${interval.startUtc.toISOString()}::timestamptz and e.at < ${interval.endUtc.toISOString()}::timestamptz
      and not exists (select 1 from sms_estimate_retirement r where r.estimate_id = e.id)`);

  return {
    interval,
    reconciliation,
    actuals: { count: num(actuals?.count), millicents: num(actuals?.millicents) },
    matched: { count: num(matched?.count), actualMillicents: num(matched?.actual_millicents), estimateCents: num(matched?.estimate_cents) },
    unresolved: { count: num(unresolved?.count), cents: num(unresolved?.cents) },
  };
}

/** The month's report: actual total, the estimates it retired, unmatched actuals, unresolved estimates, or "pending reconciliation" with its estimates counted. */
export async function smsMonthReport(executor: DbExecutor, month: MonthKey): Promise<SmsMonthReport> {
  return buildMonthReport(await smsMonthFigures(executor, month));
}
