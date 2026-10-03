// A press of Submit (and of "Try translation again") runs in a route handler whose function lives `maxDuration` seconds
// (src/app/api/staff/alerts/entries/submit/route.ts and .../retranslate/route.ts, S04.05). Four numbers must stay in order, or a submit
// is stopped while it still has work to do, or an attempt whose function is gone is taken to be alive and blocks the entry:
//
//     longest route deadline + 5 s (the submit budget)  <  maxDuration  <  ATTEMPT_STALE_MS
//
// The budget is epic E04's "longest route deadline plus 5 s", with the longest deadline the routes may have (30 s, translation's
// MAX_ROUTE_DEADLINE_MS). An attempt older than ATTEMPT_STALE_MS is read as failed (SUBMIT_ABANDONED): that is only safe once the
// function that made it cannot still be running. The budget is counted from the press: the last tests run a whole submit, with slow
// transactions and a store that hangs, and hold it to the budget from the press to the answer.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTEMPT_STALE_MS, ENTRY_CHANNELS, createEntryPreparer, createSubmitter, freezeContent, type SubmitterDeps } from "@/modules/alerting";
import {
  MAX_ROUTE_DEADLINE_MS,
  STOP_AFTER_ROUTES_MS,
  SUBMIT_MARGIN_MS,
  createSubmitTranslator,
  longestRouteDeadlineMs,
  submitBudgetMs,
  type Translator,
  type ZhHantConverter,
} from "@/modules/translation";
import { ENGLISH_ALERT, GOOD, SEEDED_ROUTES } from "../src/modules/translation/domain/alertFixtures";

const ROUTES = ["submit", "retranslate"] as const;
const maxDurationMs = (route: string) => {
  const source = readFileSync(path.join(__dirname, "..", "src", "app", "api", "staff", "alerts", "entries", route, "route.ts"), "utf8");
  return Number(/^export const maxDuration = (\d+);/m.exec(source)?.[1]) * 1000;
};

const WORST_BUDGET_MS = submitBudgetMs([{ deadlineMs: MAX_ROUTE_DEADLINE_MS }]);
/** The budget of the seeded routes (the longest route deadline, 20 s, plus 5 s). */
const SEEDED_BUDGET_MS = submitBudgetMs(SEEDED_ROUTES);
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

// --- a whole submit, from the press to the answer, inside the budget ---------------------------------------------------------------

describe("a whole submit", () => {
  const REF = { alertId: "01900000-0000-7000-8000-0000000000a1", entryId: "01900000-0000-7000-8000-0000000000e1" };
  const ACTOR = { staffId: "01900000-0000-7000-8000-000000000001", aal: "aal2" as const };
  const KEY = "0190a000-0000-7000-8000-00000000000b";
  const CONTENT = {
    text: ENGLISH_ALERT,
    types: ["elevator"],
    audience: { scope: "neighbourhood" as const, neighbourhood_ids: ["TP"], groups: [], types: ["elevator"] },
    phase: "problem" as const,
    validUntil: new Date("2026-10-04T12:00:00Z"),
  };
  const CONTEXT = { ...REF, isDrill: false, kind: "ack" as const, supersedesId: null, channels: ENTRY_CHANNELS, slug: "k3x9a2bc", verified: true, attribution: { role: "hub" as const } };
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The real preparer and the real submit translator under the seeded routes, with the one thing that only the stop can end: zh-Hant's
   * converter, which never loads, under a store grace far longer than any budget. Around it, a lifecycle whose short transactions take
   * what the arguments say, which is what the budget has to hold the translation to.
   */
  function press(options: { beginMs: number; routesMs: number; completeMs: number; stuckProgress?: boolean }) {
    const model: Translator = { translate: async ({ to }) => ({ text: GOOD[to]!, inputTokens: 1, outputTokens: 1 }) };
    const translator = createSubmitTranslator({
      translator: model,
      routes: async () => {
        await sleep(options.routesMs);
        return SEEDED_ROUTES;
      },
      cache: { get: async () => null, put: async () => undefined },
      recordSpend: async () => undefined,
      zhHant: () => new Promise<ZhHantConverter>(() => {}),
      promptVersion: "p1",
      storeGraceMs: 120_000,
      clock: () => Date.now(),
    });
    const lifecycle = {
      beginSubmit: async () => {
        await sleep(options.beginMs);
        const attempt = { key: KEY, kind: "submit", state: "running", outcome: null, startedAt: new Date(), finishedAt: null, budgetMs: null, progress: {}, resultVersion: null, resultHash: null };
        return { ok: true, value: { kind: "started", attempt, expected: CONTENT, context: CONTEXT, possibleDuplicateOf: null } };
      },
      completeSubmit: async () => {
        await sleep(options.completeMs);
        return { ok: true, value: { version: 1 } };
      },
      failSubmit: async () => true,
      recordProgress: () => (options.stuckProgress ? new Promise<void>(() => {}) : Promise.resolve()),
      recordBudget: async () => undefined,
      entryState: async () => null,
    };
    const submitter = createSubmitter({
      lifecycle: lifecycle as unknown as SubmitterDeps["lifecycle"],
      preparer: createEntryPreparer({ translator, freeze: (input) => freezeContent({ ...input, publicBaseUrl: "https://cvh.example" }) }),
      ops: { record: async () => undefined },
      now: () => new Date(),
    });
    const pressedAt = Date.now();
    let answeredAfter: number | null = null;
    const report = submitter.submit(ACTOR, REF, KEY).then((result) => {
      answeredAfter = Date.now() - pressedAt;
      return result;
    });
    return { report, answeredAfter: () => answeredAfter };
  }

  it("is answered inside the longest route deadline plus 5 s even when a store hangs and the transactions are slow", async () => {
    // 2 s to begin, 0.8 s to read the routes, 0.8 s to freeze: the translation is stopped at the longest route deadline plus 3 s after the
    // press, and not that long after the models were first asked, which would put the answer past the budget.
    const run = press({ beginMs: 2_000, routesMs: 800, completeMs: 800 });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await run.report).toMatchObject({ state: "committed" });
    expect(run.answeredAfter()).not.toBeNull();
    expect(run.answeredAfter()!).toBeLessThanOrEqual(SEEDED_BUDGET_MS);
    // It did wait for the stop (the hanging converter is what the stop ends).
    expect(run.answeredAfter()!).toBeGreaterThanOrEqual(longestRouteDeadlineMs(SEEDED_ROUTES) + STOP_AFTER_ROUTES_MS);
  });

  it("is answered inside the budget when the progress writes are stuck too: the wait for them is cut to what the budget has left", async () => {
    const run = press({ beginMs: 3_000, routesMs: 900, completeMs: 800, stuckProgress: true });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await run.report).toMatchObject({ state: "committed" });
    expect(run.answeredAfter()!).toBeLessThanOrEqual(SEEDED_BUDGET_MS);
  });

  it("stops the translation at once, every language the English fallback, when the begin alone has used the time the models could have had", async () => {
    const run = press({ beginMs: 24_000, routesMs: 0, completeMs: 500 });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await run.report).toMatchObject({ state: "committed" });
    // The begin's 24 s, no wait for the models, the freeze: not the longest route deadline and its 3 s again on top of the begin.
    expect(run.answeredAfter()!).toBeLessThanOrEqual(24_000 + 500 + 1_000);
  });
});
