// scripts/search-test-set: the usage guard every live run passes before its first call (S03.09; the calls part is S03.07's
// allowance.ts, which this builds on).
//
// A run may start only when every model it would use has a known per-unit price, or the config holds a usage allowance in
// calls and tokens a month. While Cohere's prices are unknown (they are: spend_event's price stays null), the allowance is
// what counts, in units, not money: the run's usage is estimated from its questions (the call plan, and the tokens of each
// question's text with the app's own estimators), and it is refused when that and what spend_event already holds for the
// calendar month (every purpose: the key's limit is the key's) would pass the allowance less the calls kept for live search.
// Each call the run makes is recorded by the search use case in spend_event with the purpose `test_set`.
//
// The settings, by name (only names and rules are ever printed):
//   SEARCH_TEST_MONTHLY_CALLS, SEARCH_TEST_RESERVE_CALLS   the calls a month and the live-search reserve (allowance.ts)
//   SEARCH_TEST_MONTHLY_TOKENS   the tokens a month the runs may count against (default 1,000,000, the publish allowance's), or
//                                `none`: then there is no usage allowance, and only a run whose every model is priced may start
//   SEARCH_TEST_PRICES           optional `model=price` pairs, comma separated, in CAD per million tokens: the models whose price
//                                is known. A priced run still keeps to the calls allowance (the key's limit is in calls).
import { estimateTokens } from "@/modules/directory";
import { estimateTranslationTokens, systemPrompt } from "@/modules/translation";
import type { TestQuestion } from "@/contracts/searchTestSet";
import { checkAllowance, type Allowance } from "./allowance";
import type { QuestionPlan } from "./callPlan";

/** The tokens a month the test-set runs may count against when nothing else is set (the publish allowance's default). */
export const DEFAULT_MONTHLY_TOKENS = 1_000_000;

export interface UsageBasis {
  /** The tokens a month, or null when SEARCH_TEST_MONTHLY_TOKENS is `none` (no usage allowance in config). */
  monthlyTokens: number | null;
  /** CAD per million tokens, by model, for the models whose price is known. */
  prices: Record<string, number>;
}

type Variables = Readonly<Record<string, string | undefined>>;

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PRICE = /^\d{1,6}(\.\d{1,4})?$/;

/** SEARCH_TEST_MONTHLY_TOKENS and SEARCH_TEST_PRICES, or the rules they break (names and rules, never values). */
export function resolveUsageBasis(env: Variables): { ok: true; basis: UsageBasis } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  let monthlyTokens: number | null = DEFAULT_MONTHLY_TOKENS;
  const tokens = env.SEARCH_TEST_MONTHLY_TOKENS?.trim();
  if (tokens === "none") monthlyTokens = null;
  else if (tokens !== undefined && tokens !== "") {
    if (!/^\d{1,10}$/.test(tokens) || Number(tokens) < 1) problems.push("SEARCH_TEST_MONTHLY_TOKENS: must be a whole number of at least 1, or none");
    else monthlyTokens = Number(tokens);
  }
  const prices: Record<string, number> = {};
  const list = env.SEARCH_TEST_PRICES?.trim();
  if (list) {
    for (const pair of list.split(",").map((p) => p.trim()).filter((p) => p !== "")) {
      const [model, price, ...rest] = pair.split("=").map((p) => p.trim());
      if (rest.length > 0 || !model || !MODEL.test(model) || !price || !PRICE.test(price)) {
        problems.push("SEARCH_TEST_PRICES: must be model=price pairs separated by commas, the price in CAD per million tokens (for example embed-v4.0=0.12)");
        break;
      }
      prices[model] = Number(price);
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, basis: { monthlyTokens, prices } };
}

/** What a run is estimated to use, before it makes any call. */
export interface UsageEstimate {
  /** Every call, retries included (the plan's worst case). */
  calls: number;
  /** Tokens, retries included: each question's text by the app's own estimators. */
  tokens: number;
  /** Every model the run may call: the embedding model, the routed translation models and their fallbacks. */
  models: string[];
}

/** The run's usage from its questions and their plans (callPlan.ts), one plan per question in the same order. */
export function estimateUsage(questions: readonly Pick<TestQuestion, "q">[], plans: readonly QuestionPlan[], embedModel: string): UsageEstimate {
  const prompt = systemPrompt(null, "en");
  const models = new Set<string>([embedModel]);
  let calls = 0;
  let tokens = 0;
  questions.forEach((question, i) => {
    const plan = plans[i]!;
    const translationCalls = plan.translations + plan.retries;
    calls += plan.embeddings + translationCalls;
    // The translation's embedding is about as long as the question: the question's own estimate stands for it.
    tokens += plan.embeddings * estimateTokens([question.q]) + translationCalls * estimateTranslationTokens(question.q, prompt);
    if (plan.model) models.add(plan.model);
    if (plan.fallbackModel) models.add(plan.fallbackModel);
  });
  return { calls, tokens, models: [...models].sort() };
}

export interface UsageCheck {
  /** Lines to print: the basis, the month so far and what this run can use. */
  summary: string[];
  /** Why the run is refused, naming the numbers or the models; null when it may start. */
  refusal: string | null;
  /** The most calls this run can make: its plan, and never more than its cap. */
  worst: number;
}

/**
 * Whether a run may start: every model priced or an allowance in config, then the calls (allowance.ts, with the live-search
 * reserve) and the tokens against what spend_event holds for the month (`used`, units of every purpose).
 */
export function checkUsage(allowance: Allowance, basis: UsageBasis, used: { calls: number; tokens: number }, estimate: UsageEstimate, maxCalls: number, month: string): UsageCheck {
  const unpriced = estimate.models.filter((model) => basis.prices[model] === undefined);
  const calls = checkAllowance(allowance, used.calls, estimate.calls, maxCalls, month);
  const summary = [calls.summary];
  if (basis.monthlyTokens === null && unpriced.length > 0) {
    return {
      summary,
      worst: calls.worst,
      refusal:
        `${unpriced.join(", ")} ${unpriced.length === 1 ? "has" : "have"} no known per-unit price (SEARCH_TEST_PRICES) and the config holds no usage allowance in tokens ` +
        "(SEARCH_TEST_MONTHLY_TOKENS is none): a run needs one or the other. Set SEARCH_TEST_MONTHLY_TOKENS to the tokens a month, or record every model's price.",
    };
  }
  if (calls.refusal !== null) return { summary, worst: calls.worst, refusal: calls.refusal };
  if (unpriced.length === 0) {
    const cad = (estimate.tokens / 1_000_000) * Math.max(0, ...estimate.models.map((model) => basis.prices[model]!));
    summary.push(`Every model is priced: this run costs at most about CAD ${cad.toFixed(4)} (${estimate.tokens} tokens at the dearest model's price).`);
  }
  if (basis.monthlyTokens !== null) {
    // A capped run uses at most its share of the plan's tokens.
    const tokens = estimate.calls === 0 ? 0 : Math.ceil((estimate.tokens * calls.worst) / estimate.calls);
    const room = Math.max(0, basis.monthlyTokens - used.tokens);
    summary.push(`Cohere tokens this month (${month}, America/Toronto), every purpose, from spend_event: ${used.tokens}. Allowance ${basis.monthlyTokens}, so ${room} are left; this run is estimated at ${tokens}.`);
    if (used.tokens + tokens > basis.monthlyTokens) {
      return {
        summary,
        worst: calls.worst,
        refusal: `${used.tokens} tokens used + about ${tokens} for this run is ${used.tokens + tokens}, past the allowance of ${basis.monthlyTokens} (SEARCH_TEST_MONTHLY_TOKENS). Wait for the month to turn, or raise the allowance if the key allows more.`,
      };
    }
  }
  return { summary, worst: calls.worst, refusal: null };
}
