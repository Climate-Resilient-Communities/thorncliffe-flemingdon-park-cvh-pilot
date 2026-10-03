// A press of Submit (and of "Try translation again") runs in a route handler whose function lives `maxDuration` seconds
// (src/app/api/staff/alerts/entries/submit/route.ts and .../retranslate/route.ts, S04.05). Four numbers must stay in order, or a submit
// is stopped while it still has work to do, or an attempt whose function is gone is taken to be alive and blocks the entry:
//
//     longest route deadline + 5 s (the submit budget)  <  maxDuration  <  ATTEMPT_STALE_MS
//
// The budget is epic E04's "longest route deadline plus 5 s", with the longest deadline the routes may have (30 s, translation's
// MAX_ROUTE_DEADLINE_MS). An attempt older than ATTEMPT_STALE_MS is read as failed (SUBMIT_ABANDONED): that is only safe once the
// function that made it cannot still be running.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ATTEMPT_STALE_MS } from "@/modules/alerting";
import { MAX_ROUTE_DEADLINE_MS, STOP_AFTER_ROUTES_MS, SUBMIT_MARGIN_MS, longestRouteDeadlineMs, submitBudgetMs } from "@/modules/translation";

const ROUTES = ["submit", "retranslate"] as const;
const maxDurationMs = (route: string) => {
  const source = readFileSync(path.join(__dirname, "..", "src", "app", "api", "staff", "alerts", "entries", route, "route.ts"), "utf8");
  return Number(/^export const maxDuration = (\d+);/m.exec(source)?.[1]) * 1000;
};

const WORST_BUDGET_MS = submitBudgetMs([{ deadlineMs: MAX_ROUTE_DEADLINE_MS }]);
/** What must be left of the function's time when the budget is spent, to answer and let the stores settle. */
const ANSWER_MARGIN_MS = 10 * 1000;

describe("the submit function's clock", () => {
  it("reads each route's maxDuration", () => {
    for (const route of ROUTES) expect(maxDurationMs(route), route).toBeGreaterThan(0);
  });

  it("both routes live the same time, since either may start an attempt the other waits for", () => {
    expect(maxDurationMs("submit")).toBe(maxDurationMs("retranslate"));
  });

  it("is the longest route deadline plus 5 s", () => {
    expect(SUBMIT_MARGIN_MS).toBe(5_000);
    expect(longestRouteDeadlineMs([{ deadlineMs: 12_000 }, { deadlineMs: 30_000 }, { deadlineMs: 8_000 }])).toBe(30_000);
    expect(WORST_BUDGET_MS).toBe(MAX_ROUTE_DEADLINE_MS + SUBMIT_MARGIN_MS);
  });

  it("spends its worst-case budget well before the function is stopped, leaving time to answer", () => {
    for (const route of ROUTES) expect(WORST_BUDGET_MS, route).toBeLessThan(maxDurationMs(route) - ANSWER_MARGIN_MS);
  });

  it("stops waiting for the translation (the backstop) inside the budget, so the render and the freeze still have their time", () => {
    expect(MAX_ROUTE_DEADLINE_MS + STOP_AFTER_ROUTES_MS).toBeLessThan(WORST_BUDGET_MS);
  });

  it("takes a running attempt to be abandoned only after its function can no longer be running", () => {
    for (const route of ROUTES) expect(ATTEMPT_STALE_MS, route).toBeGreaterThan(maxDurationMs(route));
  });
});
