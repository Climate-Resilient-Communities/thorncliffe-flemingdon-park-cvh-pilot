// What the composition root of search wires from the settings (S03.05, owner decision 45): the per-kind fallback for the
// resident search and none for the test-set engine, the fallback's minimum budget, and the quota warning hook. The vendor,
// the database and Next are mocked; nothing here reaches a network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchDeps } from "@/modules/directory";
import { DEFAULT_SEARCH_SETTINGS, type SearchSettings } from "@/platform/config/env";

const NORTH = "north-small-translate-09-2026";
const COMMAND = "command-a-translate-08-2025";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  createSearch: vi.fn(),
  getEnv: vi.fn(),
  /** The rows the app inserts (the ops events); nothing reaches a database. */
  inserted: [] as unknown[],
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/platform/db", () => ({ getDb: () => ({ insert: () => ({ values: async (row: unknown) => void mocks.inserted.push(row) }) }) }));
vi.mock("./directoryRelease", () => ({ directoryStorage: () => ({}) }));
vi.mock("@/platform/config/env", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/platform/config/env")>()), getEnv: mocks.getEnv }));
vi.mock("@/modules/directory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/directory")>()),
  createSearch: mocks.createSearch,
  cohereQueryEmbedder: () => ({ embedQuery: async () => ({ vector: [1], tokens: 1 }) }),
}));
vi.mock("@/modules/translation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/translation")>()),
  cohereTranslator: () => ({ translate: async () => ({ text: "x", inputTokens: 1, outputTokens: 1 }) }),
}));

/** The app's search module with these settings, and what it handed `createSearch`. */
async function load(search: Partial<SearchSettings> = {}, cohereApiKey: string | null = "a-key") {
  vi.resetModules();
  mocks.createSearch.mockReset().mockReturnValue({ search: async () => ({}), has: async () => true });
  mocks.getEnv.mockReturnValue({ cohereApiKey: cohereApiKey ?? undefined, search: { ...DEFAULT_SEARCH_SETTINGS, ...search }, supabaseSecretKey: undefined });
  const app = await import("./search");
  const deps = () => mocks.createSearch.mock.calls.at(-1)![0] as SearchDeps;
  return { app, deps };
}

describe("search composition (S03.05)", () => {
  beforeEach(() => {
    mocks.after.mockReset();
  });
  afterEach(() => vi.resetModules());

  it("gives the resident search the per-kind fallback of the settings and their minimum budget: Dari and Urdu to Command A, Pashto none", async () => {
    const { app, deps } = await load();

    app.searchService();

    const translator = deps().translator!;
    expect(translator.fallbackFor("prs", NORTH)).toBe(COMMAND);
    expect(translator.fallbackFor("ur", NORTH)).toBe(COMMAND);
    expect(translator.fallbackFor("ps", NORTH)).toBeNull();
    expect(translator.fallbackFor("romanized_or_mixed", COMMAND)).toBeNull(); // routed to Command A: no other model
    expect(translator.modelFor("ur")).toBe(NORTH);
    expect(deps().fallbackMinBudgetMs).toBe(800);
  });

  it("follows the settings: a Pashto fallback and Urdu's turned off, and another minimum budget", async () => {
    const { app, deps } = await load({ questionFallback: { ...DEFAULT_SEARCH_SETTINGS.questionFallback, ps: "pashto-model-1", ur: null }, fallbackMinBudgetMs: 300 });

    app.searchService();

    expect(deps().translator!.fallbackFor("ps", NORTH)).toBe("pashto-model-1");
    expect(deps().translator!.fallbackFor("ur", NORTH)).toBeNull();
    expect(deps().fallbackMinBudgetMs).toBe(300);
  });

  it("gives the test-set engine no fallback at all, whatever the settings say, so a run measures the routed models and not whichever answered", async () => {
    const { app, deps } = await load({ questionFallback: { ps: COMMAND, prs: COMMAND, ur: COMMAND, romanized_or_mixed: COMMAND, ambiguous_arabic: COMMAND } });

    app.searchTestSetEngine();

    const translator = deps().translator!;
    for (const kind of ["ps", "prs", "ur", "romanized_or_mixed", "ambiguous_arabic"] as const) expect(translator.fallbackFor(kind, NORTH), kind).toBeNull();
    expect(translator.modelFor("prs")).toBe(NORTH); // the routed model is still the route's
    expect(deps()).toMatchObject({ spendPurpose: "test_set", log: false });
  });

  it("leaves the translated leg out of the test-set engine when asked, and out of both where no key is configured", async () => {
    const withoutLeg = await load();
    withoutLeg.app.searchTestSetEngine({ translatedLeg: false });
    expect(withoutLeg.deps().translator).toBeNull();

    const noKey = await load({}, null);
    noKey.app.searchService();
    expect(noKey.deps().translator).toBeNull();
  });

  it("starts no quota check where no monthly limit is configured, and gives both engines the same hook where one is", async () => {
    const none = await load();
    none.app.searchService();
    expect(none.deps().onSpendWritten).toBeUndefined();

    const limited = await load({ translateMonthlyCalls: { [NORTH]: 1000 } });
    limited.app.searchService();
    const hook = limited.deps().onSpendWritten;
    expect(hook).toBeTypeOf("function");
    limited.app.searchTestSetEngine();
    expect(limited.deps().onSpendWritten).toBe(hook); // one watch per instance: once per model per month
  });

  it("hands the quota check to after() as a function, which only runs after the response, and runs it at once outside a request", async () => {
    const { app } = await load({ translateMonthlyCalls: { [NORTH]: 1000 } });
    const work = vi.fn(async () => undefined);

    app.deferAfterResponse(work);
    expect(mocks.after).toHaveBeenCalledWith(work);
    expect(work).not.toHaveBeenCalled(); // Next calls it after the response

    mocks.after.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope");
    });
    app.deferAfterResponse(work);
    expect(work).toHaveBeenCalledTimes(1);
    app.deferAfterResponse(Promise.reject(new Error("a write that failed"))); // a promise is still accepted, and never unhandled
    await Promise.resolve();
  });

  it("writes a search the route cut at its hard deadline as search.unavailable with reason deadline, the duration and its classification timed_out, nothing else", async () => {
    const { app } = await load();
    mocks.inserted.length = 0;

    await app.recordSearchDeadline(2500, "timed_out");

    expect(mocks.inserted).toEqual([{ kind: "search.unavailable", severity: "warning", subjectType: null, subjectId: null, detail: { reason: "deadline", ms: 2500, error: "timed_out" } }]);
  });

  it("writes a rate limiter that could not count as search.unavailable with reason rate_limit_failed, the duration and its classification, nothing else", async () => {
    const { app } = await load();
    mocks.inserted.length = 0;

    await app.recordLimiterFailure(1003, "42501");

    expect(mocks.inserted).toEqual([{ kind: "search.unavailable", severity: "warning", subjectType: null, subjectId: null, detail: { reason: "rate_limit_failed", ms: 1003, error: "42501" } }]);
  });

  it("gives the resident search the direct route's reranker (rerank-v3.5) with its relevance bar and monthly limit, and none when SEARCH_RERANK is off or there is no key", async () => {
    const on = await load({ rerankMin: 0.07, rerankMonthlyCalls: 500 });
    on.app.searchService();
    expect(on.deps().reranker?.model).toBe("rerank-v3.5");
    expect(on.deps().rerankMin).toBe(0.07);
    expect(on.deps().rerankMonthlyCalls).toBe(500);

    const off = await load({ rerank: false });
    off.app.searchService();
    expect(off.deps().reranker).toBeUndefined();

    const noKey = await load({}, null);
    noKey.app.searchService();
    expect(noKey.deps().reranker).toBeUndefined();
  });

  it("does not rerank in the test-set engine", async () => {
    const { app, deps } = await load();
    app.searchTestSetEngine();
    expect(deps().reranker).toBeUndefined();
  });
});
