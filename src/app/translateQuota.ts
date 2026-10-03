// The warning before a translation model's monthly limit (S03.05, owner decision 45): production depends on one free
// Cohere key whose models have a small monthly allowance, and the first sign of running out would otherwise be the 429s.
//
// `SEARCH_TRANSLATE_MONTHLY_CALLS` names a limit per model. Each time a translate spend row of such a model is written, the
// month's rows of that model (the calendar month in America/Toronto) are counted, and when they reach 80% of the limit ops
// gets one `search.leg_failed` event with reason `translate_quota_near` and the model: once per model per month per
// instance. The count runs after the response (`defer`), never in a search's time: the hook that starts it returns at once.
// It is a warning, not a gate: a failed count or a failed event changes nothing for the resident, and the next row tries again.
import { recordOpsEvent } from "@/modules/ops";
import { monthlyModelCalls, type SpendEventInput } from "@/modules/spend";
import { TRANSLATE_SPEND_KIND } from "@/modules/translation";
import type { Db } from "@/platform/db";

/** Ops is warned when a model's calls reach this share of its monthly limit, as a fraction `NEAR_NUMERATOR / NEAR_DENOMINATOR` (80%, in whole numbers). */
const NEAR_NUMERATOR = 4;
const NEAR_DENOMINATOR = 5;

/** The calendar month in America/Toronto that `now` falls in, as `2026-10` (the month the limit is counted over). */
export function torontoMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}`;
}

export interface TranslateQuotaWatchDeps {
  /** The calls a model may use in a month, by model id (SEARCH_TRANSLATE_MONTHLY_CALLS); a model not in it is never counted. */
  limits: Readonly<Record<string, number>>;
  /** The translate calls the model has used in the month `now` falls in. */
  count: (model: string, now: Date) => Promise<number>;
  /** Tells ops that the model is near its limit. */
  warn: (model: string) => Promise<void>;
  /** Runs the check after the response (the app's `after()`); the check starts from here, not from the caller. */
  defer: (work: () => Promise<unknown>) => void;
  now?: () => Date;
}

/** The hook for `SearchDeps.onSpendWritten`: hand it each spend row; it returns at once, and checks the month after the response. */
export function createTranslateQuotaWatch(deps: TranslateQuotaWatchDeps): (event: SpendEventInput) => void {
  const now = deps.now ?? (() => new Date());
  // Models already warned of this month, as `model:month`. Kept in memory: an instance that starts later may warn again.
  const warned = new Set<string>();
  return (event) => {
    if (event.kind !== TRANSLATE_SPEND_KIND || !Object.hasOwn(deps.limits, event.model)) return;
    const limit = deps.limits[event.model]!;
    const at = now();
    const key = `${event.model}:${torontoMonth(at)}`;
    if (warned.has(key)) return;
    deps.defer(async () => {
      try {
        if (warned.has(key)) return;
        const calls = await deps.count(event.model, at);
        // Another row's check may have warned while this one counted.
        if (calls * NEAR_DENOMINATOR < limit * NEAR_NUMERATOR || warned.has(key)) return;
        warned.add(key);
        try {
          await deps.warn(event.model);
        } catch {
          warned.delete(key); // the event was not written: the next row tries again
        }
      } catch {
        // A warning that could not be made is not worth more than the next attempt.
      }
    });
  };
}

/** The watch over the database and the ops log: the composition root's wiring of `createTranslateQuotaWatch`. */
export function translateQuotaWatch(options: { db: () => Db; limits: Readonly<Record<string, number>>; defer: TranslateQuotaWatchDeps["defer"]; now?: () => Date }) {
  return createTranslateQuotaWatch({
    limits: options.limits,
    defer: options.defer,
    now: options.now,
    count: (model, now) => monthlyModelCalls(options.db(), TRANSLATE_SPEND_KIND, model, now),
    // Not a search that failed: no request, so no duration.
    warn: (model) => recordOpsEvent(options.db(), { kind: "search.leg_failed", detail: { reason: "translate_quota_near", ms: 0, model } }),
  });
}
