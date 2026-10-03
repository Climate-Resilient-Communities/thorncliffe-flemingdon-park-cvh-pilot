// scripts/search-test-set: the month's allowance on the shared Cohere key (S03.07). Production uses a free trial key that live
// search shares, with about 1,000 calls a month in all, and one run of both legs plans about 440 of them. A fixed cap on a run
// (--max-calls) does not know how much of the month live search and earlier runs have used, and a key that runs out gives every
// resident's question a 429 for the rest of the month (search answers "unavailable"). So before the first call a run reads the
// month's calls from spend_event (every purpose, embedding and translation, the calendar month in America/Toronto: the count the
// translation quota watch uses) and refuses a run that would leave less than the reserve kept for live search.
//
// spend_event is the app's own record, written for every call the use case made: it can miss a call that never reached the
// recording (a process that died), and the vendor's own count (the Cohere dashboard) is the one that decides; the allowance and
// the reserve are the owner's to set with SEARCH_TEST_MONTHLY_CALLS and SEARCH_TEST_RESERVE_CALLS.

/** The calls a month the key allows in all (the free trial key's). */
export const DEFAULT_MONTHLY_ALLOWANCE = 1000;
/** The calls a month kept for live search: a run never uses them. */
export const DEFAULT_LIVE_RESERVE = 200;

export type Allowance = { monthly: number; reserve: number };

type Variables = Readonly<Record<string, string | undefined>>;

const WHOLE_NUMBER = /^\d{1,7}$/;

/** The allowance from SEARCH_TEST_MONTHLY_CALLS and SEARCH_TEST_RESERVE_CALLS (blank or unset is the default), or the rules broken (names and rules, never values). */
export function resolveAllowance(env: Variables): { ok: true; allowance: Allowance } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const read = (name: string, fallback: number, least: number): number => {
    const text = env[name]?.trim();
    if (text === undefined || text === "") return fallback;
    if (!WHOLE_NUMBER.test(text) || Number(text) < least) {
      problems.push(`${name}: must be a whole number of at least ${least}`);
      return fallback;
    }
    return Number(text);
  };
  const monthly = read("SEARCH_TEST_MONTHLY_CALLS", DEFAULT_MONTHLY_ALLOWANCE, 1);
  const reserve = read("SEARCH_TEST_RESERVE_CALLS", DEFAULT_LIVE_RESERVE, 0);
  if (problems.length === 0 && reserve >= monthly) problems.push("SEARCH_TEST_RESERVE_CALLS: must be less than SEARCH_TEST_MONTHLY_CALLS, or no run could ever be made");
  return problems.length > 0 ? { ok: false, problems } : { ok: true, allowance: { monthly, reserve } };
}

/** The allowance as a line of the plan, so the owner sees it before any call or connection. */
export function formatAllowance(allowance: Allowance): string {
  return `  allowance: ${allowance.monthly} calls a month on the key, ${allowance.reserve} kept for live search (SEARCH_TEST_MONTHLY_CALLS, SEARCH_TEST_RESERVE_CALLS); with --yes the run first reads this month's calls from spend_event and refuses a run that would pass what is left`;
}

export interface AllowanceCheck {
  /** The month's calls, what a run may still use, and what this run can make at most, as a line to print. */
  summary: string;
  /** Why the run is refused, naming the numbers; null when it fits. */
  refusal: string | null;
  /** What a run may still use this month: the allowance less the reserve less the calls already made (never below 0). */
  room: number;
  /** What the run can make at most: its plan with every retry, and never more than its cap. */
  worst: number;
}

/**
 * Whether a run fits in what is left of the month. `used` is the month's calls so far, whoever made them; `plannedWorst` is the
 * plan with every retry, over all legs, and a run never makes more than `maxCalls`. It fits when `used` plus the most it can make
 * stays within the allowance less the reserve.
 */
export function checkAllowance(allowance: Allowance, used: number, plannedWorst: number, maxCalls: number, month: string): AllowanceCheck {
  const worst = Math.min(plannedWorst, maxCalls);
  const usable = allowance.monthly - allowance.reserve;
  const room = Math.max(0, usable - used);
  const summary = `Cohere calls this month (${month}, America/Toronto), every purpose, from spend_event: ${used}. Allowance ${allowance.monthly}, ${allowance.reserve} kept for live search, so a run may use ${room} more; this run makes at most ${worst}.`;
  const refusal =
    used + worst <= usable
      ? null
      : `${used} calls used + at most ${worst} for this run is ${used + worst}, past ${usable} (the allowance ${allowance.monthly} less the ${allowance.reserve} kept for live search). ` +
        (room > 0 ? `Run one leg, or pass --max-calls ${room} or less, or wait for the month to turn. ` : "Wait for the month to turn. ") +
        "If the key's allowance is larger now, set SEARCH_TEST_MONTHLY_CALLS: the vendor's own count (the Cohere dashboard) is the one that decides.";
  return { summary, refusal, room, worst };
}
