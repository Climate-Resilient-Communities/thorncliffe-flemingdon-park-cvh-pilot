// The spend module's public interface (AD-2): the record of paid vendor usage. Other modules record usage and ask what
// the month has used only through these functions.
//
// Cohere (S03.02, S04.02): one event per call (`recordSpendEvent`), counted in calls and tokens while the price is unknown.
// Text messages (S06.08): one estimate per delivery, written when the provider accepts the text or its outcome becomes `unknown`
// (`recordSmsEstimate`); the provider's actual prices, imported by month-long reconciliations (`createSmsReconciler`); the matching rule that
// retires an estimate by the actual of its delivery's provider id (`retireSmsEstimates`, `matchUnretiredEstimates`); and the month's report
// (`smsMonthReport`).
export { SPEND_LOCK_KEY, monthlyModelCalls, monthlyUsage, recordSpendEvent, withSpendLock, type MonthlyUsage } from "./application/spend";
export { SPEND_PURPOSES, SpendEventError, SpendEventSchema, toSpendEvent, type SpendEvent, type SpendEventInput, type SpendPurpose } from "./domain/events";

export {
  DEFAULT_LISTING_DEADLINE_MS,
  DEFAULT_MAX_PAGES,
  createSmsReconciler,
  matchUnretiredEstimates,
  type DeliveryProviderIds,
  type ReconcileResult,
  type SmsReconciler,
  type SmsReconcilerDeps,
  type SpendLog,
} from "./application/smsReconciler";
export { listMessages, type ListOptions, type Listing, type ListingLimits, type MessagePage, type SmsMessageLister } from "./application/smsListing";
export {
  completeSmsReconciliation,
  importSmsActuals,
  lockSmsReconciliation,
  pendingReconciliationMonths,
  readSmsReconciliation,
  recordPendingReconciliation,
  recordSmsEstimate,
  retireSmsEstimates,
  smsMonthFigures,
  smsMonthReport,
  startSmsReconciliation,
  unreconciledEstimateMonths,
  unretiredSmsEstimateDeliveries,
  type ProviderIdPair,
  type ReconciliationRow,
} from "./application/smsSpend";
export { stdoutSpendLog } from "./adapters/spendLog";
// Cost per alert (S07.10, FR-M5): SMS cost by language (actual where reported, otherwise a labelled estimate) and the alerts' share of the vendor's usage.
export { COST_BASES, readAlertCost, readCohereShare, type AlertCost, type AlertCostReport, type AlertCostRow, type CohereEntryShare, type CohereShare, type CostBasis } from "./application/alertCost";
export {
  PENDING_REASONS,
  TORONTO,
  monthInterval,
  monthOf,
  monthReconciliationId,
  parseReconciliationId,
  previousMonth,
  type MonthKey,
  type PendingReason,
  type ReconciliationInterval,
} from "./domain/reconciliation";
export { isOutbound, toActuals, type ActualInput, type ActualsResult, type ProviderMessage } from "./domain/smsActuals";
export { SMS_ESTIMATE_PURPOSES, SMS_KIND, SMS_MODEL, SMS_SEGMENTS_MAX, SmsEstimateError, SmsEstimateSchema, toSmsEstimate, type SmsEstimate, type SmsEstimateInput, type SmsEstimatePurpose } from "./domain/smsEstimate";
export { centsOf, rateInTenThousandths, toCadMillicents, type CadConversion, type Millicents } from "./domain/smsPrice";
export { SMS_SPEND_LABELS, buildMonthReport, type MonthFigures, type SmsMonthReport } from "./domain/smsReport";
