// The monthly cap on text message spending (S07.08, AR-12, FR-G6): the one `spend_cap` row, setting it, and judging an approval against it.
//
//  - `set` is one transaction: the row is locked `FOR UPDATE`, changed, and the `spend.cap_set` audit record written in the same transaction (a cap
//    that cannot be audited is not set). Who may set it is the staff guard's rule (the policy action `spend.cap`, Admins, at aal2), asked before this.
//  - `assessApproval` is called by the approval's own transaction (alerting, S04.07), last in the lock order of AD-18: it locks the row, adds up the
//    month (Toronto calendar month) and answers how far the entry's estimate would take it past the cap. It never refuses anything: the cap warns.
import { eq, sql } from "drizzle-orm";
import type { Db, DbExecutor, DbTransaction } from "@/platform/db";
import type { AuditEvent } from "../../audit";
import { spendCap } from "../adapters/schema";
import { monthOf } from "../domain/reconciliation";
import { assessCap, parseCapAmount, type CapAssessment, type CapProblem } from "../domain/spendCap";
import { smsMonthReport } from "./smsSpend";

export interface SpendCapRow {
  /** The cap in cents CAD; null while none has been set. */
  monthlyCents: number | null;
  setBy: string | null;
  setAt: Date | null;
}

/** The migration makes the one row and the app cannot delete it: a missing row is a broken database. */
export class SpendCapMissing extends Error {
  constructor() {
    super("The spend cap (spend_cap) has no row");
    this.name = "SpendCapMissing";
  }
}

const rowOf = (row: typeof spendCap.$inferSelect): SpendCapRow => ({ monthlyCents: row.monthlyCents, setBy: row.setBy, setAt: row.setAt });

/** The cap as it is now. */
export async function readSpendCap(executor: DbExecutor): Promise<SpendCapRow> {
  const [row] = await executor.select().from(spendCap).where(eq(spendCap.id, 1));
  if (!row) throw new SpendCapMissing();
  return rowOf(row);
}

/** The cap, locked `FOR UPDATE` in the caller's transaction. */
export async function lockSpendCap(tx: DbTransaction): Promise<SpendCapRow> {
  const [row] = await tx.select().from(spendCap).where(eq(spendCap.id, 1)).for("update");
  if (!row) throw new SpendCapMissing();
  return rowOf(row);
}

/** The month's text message spending so far, in whole cents CAD: the month's report counted (actual where reconciled, estimates otherwise). */
export async function monthSpentCents(executor: DbExecutor, now: Date): Promise<number> {
  return (await smsMonthReport(executor, monthOf(now))).countedCents;
}

export interface ApprovalCapInput {
  /** This entry's own estimate, in whole cents. */
  estimateCents: number;
  /**
   * The estimate of the texts waiting to be sent, not including this entry's own (messaging's `queuedCostCents`). Asked for AFTER the cap's lock is taken, so an
   * approval that waited for another one sees the texts that one queued.
   */
  queuedCents: () => Promise<number>;
  now: Date;
}

/** What an approval is told: the assessment, with the cap that was read. `capCents` is null while no cap is set (then `overCents` is 0). */
export async function assessApproval(tx: DbTransaction, input: ApprovalCapInput): Promise<CapAssessment> {
  const cap = await lockSpendCap(tx);
  if (cap.monthlyCents === null) return assessCap({ capCents: null, spentCents: 0, queuedCents: 0, estimateCents: input.estimateCents });
  const spentCents = await monthSpentCents(tx, input.now);
  return assessCap({ capCents: cap.monthlyCents, spentCents, queuedCents: await input.queuedCents(), estimateCents: input.estimateCents });
}

/** Where `set` writes its audit records: the audit module's `record` and `recordRefusal`. */
export interface SpendCapAudit {
  record(tx: DbTransaction, event: AuditEvent<"spend.cap_set">): Promise<unknown>;
  recordRefusal(db: Db, event: { action: "spend.cap_set"; actorStaffId: string | null; subjectType: string; subjectId: string | null; meta: { reason: "validation" } }): Promise<unknown>;
}

export type SetCapOutcome = { kind: "set"; capCents: number; previousCents: number | null } | { kind: "refused"; problem: CapProblem };

export interface SpendCapService {
  read(executor?: DbExecutor): Promise<SpendCapRow>;
  /** Sets or changes the cap to `amount` (dollars, as typed), as the Admin the guard let through. */
  set(input: { actorStaffId: string; amount: unknown }): Promise<SetCapOutcome>;
}

const SUBJECT = { subjectType: "spend_cap", subjectId: "1" } as const;

export function createSpendCap(deps: { db: Db; audit: SpendCapAudit }): SpendCapService {
  const { db, audit } = deps;
  return {
    read: (executor) => readSpendCap(executor ?? db),

    async set({ actorStaffId, amount }) {
      const parsed = parseCapAmount(amount);
      if (!parsed.ok) {
        await audit.recordRefusal(db, { action: "spend.cap_set", actorStaffId, ...SUBJECT, meta: { reason: "validation" } });
        return { kind: "refused", problem: parsed.problem };
      }
      return db.transaction(async (tx): Promise<SetCapOutcome> => {
        const previous = await lockSpendCap(tx);
        await tx.update(spendCap).set({ monthlyCents: parsed.cents, setBy: actorStaffId, setAt: sql`now()` }).where(eq(spendCap.id, 1));
        await audit.record(tx, {
          action: "spend.cap_set",
          actorStaffId,
          ...SUBJECT,
          meta: { cap_cents: parsed.cents, ...(previous.monthlyCents === null ? {} : { previous_cents: previous.monthlyCents }) },
        });
        return { kind: "set", capCents: parsed.cents, previousCents: previous.monthlyCents };
      });
    },
  };
}
