// The spend module's public interface (AD-2): the record of paid vendor usage. Other modules record usage and ask what
// the month has used only through these functions.
export { SPEND_LOCK_KEY, monthlyUsage, recordSpendEvent, withSpendLock, type MonthlyUsage } from "./application/spend";
export { SPEND_PURPOSES, SpendEventError, SpendEventSchema, toSpendEvent, type SpendEvent, type SpendEventInput, type SpendPurpose } from "./domain/events";
