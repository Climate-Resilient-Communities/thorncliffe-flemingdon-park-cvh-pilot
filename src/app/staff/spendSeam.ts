// Composition root of the spend view, the monthly cap and the approval's cap notice for the staff surface (S07.08, AD-2): the spend module on the
// app's database connection (cvh_app_login), with the audit trail. Server only. A seam of its own, like ./messagingPause.ts, so the tests that call
// the staff pages and actions directly can hand them a database.
import { englishText } from "@/i18n/text";
import { record, recordRefusal } from "@/modules/audit";
import { queuedCostCents } from "@/modules/messaging";
import { assessCap, createSpendCap, monthSpentCents, readSpendCap, readSpendOverview, type SpendCapService, type SpendOverview } from "@/modules/spend";
import { getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";
import { formatCents } from "./alerts/approval/view";

/** The cap: read and set (an Admin at aal2, audited). */
export function spendCap(): SpendCapService {
  return createSpendCap({ db: getDb(), audit: { record: (tx, event) => record(tx, event), recordRefusal: (db, event) => recordRefusal(db, event) } });
}

/** The spend view's figures for now, against the configured budget. */
export function readOverview(now: Date = new Date()): Promise<SpendOverview> {
  const env = getEnv();
  const options = { now, budgetCents: env.spendPilotBudgetCents, cohereEstimateCadPerMillionTokens: env.spendTokenEstimateCadPerMillion };
  // One snapshot, so this month, the pilot to date, the budget and the cap agree on one page view.
  return getDb().transaction((tx) => readSpendOverview(tx, options), { isolationLevel: "repeatable read" });
}

/** Operational error log (structured, no personal data). */
export function logSpendError(event: string, fields: Record<string, string>): void {
  console.error(JSON.stringify({ evt: event, module: "spend", ...fields }));
}

export interface CapNoticeDeps {
  /** The cap in cents, or null while none is set. */
  capCents: () => Promise<number | null>;
  /** The month's text message spending so far, in cents. */
  spentCents: (now: Date) => Promise<number>;
  /** The estimate of the texts waiting to be sent, in cents. */
  queuedCents: () => Promise<number>;
  now: () => Date;
  logError: (event: string, fields: Record<string, string>) => void;
}

const live: CapNoticeDeps = {
  capCents: async () => (await readSpendCap(getDb())).monthlyCents,
  spentCents: (now) => monthSpentCents(getDb(), now),
  queuedCents: () => queuedCostCents(getDb()),
  now: () => new Date(),
  logError: logSpendError,
};

/**
 * The sentence an approver is shown BEFORE approving when this entry's estimate would take the month's text spending past the cap (S07.08): the
 * shortfall, and that the alert can still be approved. Null when it would not, when no cap is set, or when the entry has no estimate. Like the pause
 * notice it only informs: if the figures cannot be read the approver is shown nothing and the failure is logged by the error's name, because the
 * cap never blocks an approval (the use case judges it again, in the approval's own transaction).
 */
export async function capNoticeFor(estimateCents: number | null, deps: CapNoticeDeps = live): Promise<string | null> {
  if (estimateCents === null || estimateCents <= 0) return null;
  try {
    const cap = await deps.capCents();
    if (cap === null) return null;
    const assessment = assessCap({ capCents: cap, spentCents: await deps.spentCents(deps.now()), queuedCents: await deps.queuedCents(), estimateCents });
    if (assessment.overCents === 0) return null;
    const amount = (cents: number) => `${formatCents(cents)} CAD`;
    return englishText("staff.approve.capNotice", { over: amount(assessment.overCents), cap: amount(cap), projected: amount(assessment.projectedCents) });
  } catch (error) {
    deps.logError("approval.cap_notice_failed", { error: error instanceof Error ? error.name : "NonError" });
    return null;
  }
}
