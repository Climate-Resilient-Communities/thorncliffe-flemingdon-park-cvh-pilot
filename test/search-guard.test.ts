// The search guard (S03.09) with a fake engine in place of the search use case: the launch bar as S03.08 writes it (no bar yet passes
// and calls nothing), the evaluation subset (subsets.json or the questions' split), the comparison that names each measure below its
// minimum and the drop, the usage guard before any live run (every model priced or an allowance in config; the month's calls and
// tokens from spend_event; refused when the run would pass what is left), the ops events of a manual checkpoint (and none for a pull
// request), and an incomplete run that cannot pass. The production engine over a real database is test/db/search.db.test.ts.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestSetReportSchema, type SearchV1, type SubsetReport, type TestQuestion } from "@/contracts/searchTestSet";
import type { VendorFailure, VendorUsage } from "@/contracts/searchTuning";
import { OPS_EVENT_KINDS, toOpsEventRecord } from "@/modules/ops";
import { DEFAULT_SEARCH_SETTINGS } from "@/platform/config/env";
import { checkBar, evaluationIds, formatShortfall, parseBar, readBar, type Bar } from "../scripts/search-test-set/bar";
import { planQuestion, planningTranslator, type QuestionPlan } from "../scripts/search-test-set/callPlan";
import { parseGuardOptions, runGuard, type GuardDeps } from "../scripts/search-test-set/guard";
import { measureSubset, type QuestionResult } from "../scripts/search-test-set/lib";
import { runProduction } from "../scripts/search-test-set/production";
import type { Asked, TuningEngine } from "../scripts/search-test-set/tuningRun";
import { DEFAULT_MONTHLY_TOKENS, checkUsage, estimateUsage, resolveUsageBasis } from "../scripts/search-test-set/usageGuard";

const temp: string[] = [];
afterAll(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cvh-guard-"));
  temp.push(dir);
  return dir;
};

let logs: string[];
let errs: string[];
beforeEach(() => {
  logs = [];
  errs = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
  vi.spyOn(console, "warn").mockImplementation((...a) => void errs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void errs.push(a.join(" ")));
});
afterEach(() => vi.restoreAllMocks());

function q(id: string, over: Partial<TestQuestion> = {}): TestQuestion {
  return { id, lang: "en", q: `text of ${id}`, form: "native", intent: "normal", expected: ["M001"], split: "evaluation", author: "dev-agent", added: "2026-10-02", checked_by: null, checked_on: null, ...over };
}

const BAR = { version: 1, approvedBy: "Hub Director", approvedOn: "2026-10-20", minimums: { hitRate: { en: 0.8, ur: 0.7 }, noMatchAccuracy: 0.9, emergencyAccuracy: 1 } };

describe("the launch bar (the shape agreed with S03.08)", () => {
  it("is no bar yet while nobody has approved it or it holds no minimum, and a missing file is no bar either", () => {
    expect(parseBar(JSON.stringify({ version: 1, approvedBy: null, approvedOn: null, minimums: { hitRate: {}, noMatchAccuracy: 0, emergencyAccuracy: 0 } }))).toEqual({ set: false, reason: expect.stringContaining("not been approved") });
    expect(() => parseBar(JSON.stringify({ ...BAR, approvedOn: null }))).toThrow(/both set or both null/); // half approved is a broken bar
    expect(parseBar(JSON.stringify({ ...BAR, minimums: { hitRate: {}, noMatchAccuracy: 0, emergencyAccuracy: 0 } }))).toEqual({ set: false, reason: "the launch bar holds no minimum yet" });
    expect(parseBar(readFileSync(path.join(__dirname, "..", "data", "search-test-set", "bar.json"), "utf8"))).toMatchObject({ set: false }); // as committed
    expect(readBar(tempDir())).toEqual({ set: false, reason: "there is no data/search-test-set/bar.json yet" });
  });

  it("reads the approved minimums, and refuses a file that is not a bar instead of passing it as no bar", () => {
    expect(parseBar(JSON.stringify(BAR))).toEqual({ set: true, bar: { approvedBy: "Hub Director", approvedOn: "2026-10-20", hitRate: { en: 0.8, ur: 0.7 }, noMatchAccuracy: 0.9, emergencyAccuracy: 1 } });
    expect(() => parseBar(JSON.stringify({ ...BAR, minimums: { hitRate: { en: 80 } } }))).toThrow(/not a launch bar/);
    expect(() => parseBar(JSON.stringify({ ...BAR, version: 2 }))).toThrow(/not a launch bar/);
    // S03.08's exact shape: every key present, no minimums object left out or null.
    expect(() => parseBar(JSON.stringify({ version: 1, approvedBy: "Hub Director", approvedOn: "2026-10-20" }))).toThrow(/not a launch bar/);
    expect(() => parseBar(JSON.stringify({ ...BAR, minimums: { hitRate: {} } }))).toThrow(/not a launch bar/);
    expect(() => parseBar(JSON.stringify({ ...BAR, minimums: null }))).toThrow(/not a launch bar/);
  });

  it("takes the evaluation subset from subsets.json when S03.08 has committed it, otherwise from the questions' split, and refuses an id the questions do not hold", () => {
    const root = tempDir();
    const questions = [q("a", { split: "tuning" }), q("b"), q("c", { split: "tuning" })];
    expect(evaluationIds(root, questions)).toEqual({ ok: true, ids: ["b"], source: "the questions' split" });
    mkdirSync(path.join(root, "data", "search-test-set"), { recursive: true });
    writeFileSync(path.join(root, "data", "search-test-set", "subsets.json"), JSON.stringify({ seed: 7, evaluation: ["a", "b"], tuning: ["c"] }));
    expect(evaluationIds(root, questions)).toEqual({ ok: true, ids: ["a", "b"], source: "data/search-test-set/subsets.json" });
    writeFileSync(path.join(root, "data", "search-test-set", "subsets.json"), JSON.stringify({ seed: 7, evaluation: ["a", "zz"], tuning: [] }));
    expect(evaluationIds(root, questions)).toEqual({ ok: false, error: expect.stringContaining("zz") });
  });
});

/** A subset report from results: `hits` of `of` questions in a language hit. */
function subset(spec: { lang: string; hits: number; of: number }[], noMatch: { clear: number; of: number }, emergency: { first: number; of: number }): SubsetReport {
  const results: QuestionResult[] = [];
  const answer = (question: TestQuestion, hit: boolean, emergencyFirst = false): QuestionResult => ({
    question,
    status: hit ? "ok" : "no_clear_match",
    emergency_first: emergencyFirst,
    results: hit ? [{ provider_id: "M001", score: 0.9 }] : [],
    query_lang: question.lang,
    ms: 100,
    missing: [],
  });
  for (const { lang, hits, of } of spec) for (let i = 0; i < of; i++) results.push(answer(q(`${lang}-${i}`, { lang: lang as TestQuestion["lang"] }), i < hits));
  for (let i = 0; i < noMatch.of; i++) results.push(answer(q(`nm-${i}`, { intent: "no_match", expected: [] }), i >= noMatch.clear));
  for (let i = 0; i < emergency.of; i++) results.push(answer(q(`em-${i}`, { intent: "emergency", lang: "es" }), true, i < emergency.first));
  return measureSubset(results);
}

describe("checking a report against the bar", () => {
  const bar: Bar = { approvedBy: "Hub Director", approvedOn: "2026-10-20", hitRate: { en: 0.8, ur: 0.7 }, noMatchAccuracy: 0.9, emergencyAccuracy: 1 };

  it("passes when every minimum is met, an equal share included", () => {
    expect(checkBar(bar, subset([{ lang: "en", hits: 4, of: 5 }, { lang: "ur", hits: 4, of: 5 }], { clear: 9, of: 10 }, { first: 2, of: 2 }))).toEqual([]);
  });

  it("names each measure below its minimum and the drop: a language's hit rate, the no-match accuracy, the emergency accuracy, and a language it could not measure", () => {
    const shortfalls = checkBar(bar, subset([{ lang: "en", hits: 3, of: 5 }], { clear: 8, of: 10 }, { first: 1, of: 2 }));

    expect(shortfalls).toEqual([
      { measure: "hit_rate", lang: "en", observed: 0.6, minimum: 0.8 },
      { measure: "hit_rate", lang: "ur", observed: null, minimum: 0.7 },
      { measure: "no_match_accuracy", lang: null, observed: 0.8, minimum: 0.9 },
      { measure: "emergency_accuracy", lang: null, observed: 0.5, minimum: 1 },
    ]);
    expect(shortfalls.map(formatShortfall)).toEqual([
      "hit rate (en): 60.0%, below the minimum 80.0% by 20.0 points",
      "hit rate (ur): not measured (no question of it was scored), minimum 70.0%",
      "no-match accuracy: 80.0%, below the minimum 90.0% by 10.0 points",
      "emergency accuracy: 50.0%, below the minimum 100.0% by 50.0 points",
    ]);
  });

  it("checks only the measures the bar sets", () => {
    const partial: Bar = { ...bar, hitRate: {}, emergencyAccuracy: null };
    expect(checkBar(partial, subset([{ lang: "en", hits: 0, of: 5 }], { clear: 10, of: 10 }, { first: 0, of: 2 }))).toEqual([]);
  });
});

describe("the usage guard before any live run", () => {
  const allowance = { monthly: 1000, reserve: 200 };
  const estimate = { calls: 100, tokens: 5000, models: ["command-a-translate-08-2025", "embed-v4.0"] };

  it("reads the token allowance (default the publish allowance's, or none) and the known prices, naming a broken setting and not its value", () => {
    expect(resolveUsageBasis({})).toEqual({ ok: true, basis: { monthlyTokens: DEFAULT_MONTHLY_TOKENS, prices: {} } });
    expect(resolveUsageBasis({ SEARCH_TEST_MONTHLY_TOKENS: "none", SEARCH_TEST_PRICES: "embed-v4.0=0.12, command-a-translate-08-2025=2.5" })).toEqual({
      ok: true,
      basis: { monthlyTokens: null, prices: { "embed-v4.0": 0.12, "command-a-translate-08-2025": 2.5 } },
    });
    expect(resolveUsageBasis({ SEARCH_TEST_MONTHLY_TOKENS: "lots" })).toEqual({ ok: false, problems: ["SEARCH_TEST_MONTHLY_TOKENS: must be a whole number of at least 1, or none"] });
    const bad = resolveUsageBasis({ SEARCH_TEST_PRICES: "embed-v4.0=secret-ish" });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain("secret-ish");
  });

  it("estimates the run from its questions: every call of the plan, retries included, the tokens of each question by the app's own estimators, and every model it may call", () => {
    const translator = planningTranslator(DEFAULT_SEARCH_SETTINGS);
    const questions = [q("en-1", { q: "where can I find a lawyer" }), q("ps-1", { lang: "ps", q: "زه وکیل ته اړتیا لرم" }), q("ur-1", { lang: "ur", q: "مجھے وکیل چاہیے" })];
    const plans: QuestionPlan[] = questions.map((x) => planQuestion(x, translator));
    const e = estimateUsage(questions, plans, "embed-v4.0");

    expect(e.calls).toBe(plans.reduce((n, p) => n + p.embeddings + p.translations + p.retries, 0));
    expect(e.calls).toBeGreaterThan(3);
    expect(e.tokens).toBeGreaterThan(0);
    expect(e.models).toEqual(expect.arrayContaining(["embed-v4.0", DEFAULT_SEARCH_SETTINGS.questionRoute.ps!, DEFAULT_SEARCH_SETTINGS.questionFallback.ur!]));
  });

  it("refuses a run when a model has no known price and the config holds no usage allowance", () => {
    const check = checkUsage(allowance, { monthlyTokens: null, prices: { "embed-v4.0": 0.12 } }, { calls: 0, tokens: 0 }, estimate, 500, "2026-10");
    expect(check.refusal).toContain("command-a-translate-08-2025 has no known per-unit price");
  });

  it("lets a run whose every model is priced start without a token allowance, and still keeps it to the key's calls", () => {
    const priced = { monthlyTokens: null, prices: { "embed-v4.0": 0.12, "command-a-translate-08-2025": 2.5 } };
    const ok = checkUsage(allowance, priced, { calls: 0, tokens: 0 }, estimate, 500, "2026-10");
    expect(ok.refusal).toBeNull();
    expect(ok.summary.join("\n")).toContain("Every model is priced");
    expect(checkUsage(allowance, priced, { calls: 750, tokens: 0 }, estimate, 500, "2026-10").refusal).toContain("past 800");
  });

  it("refuses a run that would pass what is left of the month: the calls (with the live-search reserve) and the tokens, counted from spend_event's units", () => {
    const basis = { monthlyTokens: 10_000, prices: {} };
    expect(checkUsage(allowance, basis, { calls: 700, tokens: 5000 }, estimate, 500, "2026-10").refusal).toBeNull();
    expect(checkUsage(allowance, basis, { calls: 701, tokens: 0 }, estimate, 500, "2026-10").refusal).toContain("701 calls used + at most 100");
    const tokens = checkUsage(allowance, basis, { calls: 0, tokens: 5001 }, estimate, 500, "2026-10");
    expect(tokens.refusal).toContain("5001 tokens used + about 5000 for this run is 10001, past the allowance of 10000");
    // A capped run is held to its share of the plan's tokens.
    expect(checkUsage(allowance, basis, { calls: 0, tokens: 7000 }, estimate, 50, "2026-10").refusal).toBeNull();
  });

  it("guards the S03.07 tuning run too: its tokens are read from spend_event and a run past the token allowance is refused before any engine is made", async () => {
    const makeEngine = vi.fn();
    const dir = tempDir();
    const code = await runProduction(
      ["run", "--engine", "production", "--model", "embed-v4.0", "--translated-leg", "off", "--yes", "--out-dir", dir],
      { ...SECRETS, SEARCH_TEST_MONTHLY_TOKENS: "100" },
      dir,
      { loadQuestions: () => ({ questions: [{ ...q("en-1", { split: "tuning" }), line: 1 }], errors: [], sha256: "a".repeat(64) }), makeEngine, monthCalls: vi.fn(), monthUsage: async () => ({ calls: 0, tokens: 100 }), usage: "USAGE" },
    );
    expect(code).toBe(1);
    expect(makeEngine).not.toHaveBeenCalled();
    expect(errs.join("\n")).toContain("past the allowance of 100");
  });
});

describe("the search.below_bar ops event", () => {
  it("holds the measure, the language of a hit rate, the shares in thousandths and the checkpoint, and nothing else", () => {
    expect(OPS_EVENT_KINDS["search.below_bar"].severity).toBe("warning");
    expect(toOpsEventRecord({ kind: "search.below_bar", subjectType: "directory_release", subjectId: "4", detail: { measure: "hit_rate", lang: "ur", observed_permille: 600, minimum_permille: 700, checkpoint: "week_4" } })).toMatchObject({
      kind: "search.below_bar",
      severity: "warning",
      detail: { measure: "hit_rate", lang: "ur", observed_permille: 600, minimum_permille: 700, checkpoint: "week_4" },
    });
    for (const detail of [
      { measure: "hit_rate", minimum_permille: 700, checkpoint: "pr" },
      { measure: "speed", minimum_permille: 700, checkpoint: "week_4" },
      { measure: "hit_rate", minimum_permille: 700, checkpoint: "week_4", question: "where is a lawyer" },
      { measure: "hit_rate", minimum_permille: 1700, checkpoint: "week_4" },
    ]) {
      expect(() => toOpsEventRecord({ kind: "search.below_bar", detail } as never)).toThrow();
    }
  });
});

// --- the guard's command line, end to end, with a fake engine ----------------------------------------------------

const SECRETS = {
  SEARCH_TEST_DATABASE_URL: "postgres://postgres:db-password-value@db.example.com:5432/postgres",
  COHERE_API_KEY: "cohere-key-value-123",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "supabase-secret-value-456",
};

const NO_CALLS = { embedding: 1, translation: 0, translationModels: [] as string[], failures: [] as VendorFailure[] };
const emptyKind = () => ({ calls: 0, rate_limited: 0, failed: 0, aborted: 0, tokens: 0, unreported_calls: 0, by_model: {} });
const EMPTY_USAGE: VendorUsage = { embedding: emptyKind(), translation: emptyKind() };
const PLAN: QuestionPlan = { embeddings: 1, translations: 0, retries: 0, model: null, fallbackModel: null };

/** The answer a fake search gives: a hit on M001, no clear match, or the 911 block first. */
function asked(kind: "hit" | "miss" | "none" | "emergency" | "limited"): Asked {
  if (kind === "limited") return { answer: null, failure: "search_unavailable", observation: null, trace: { ...NO_CALLS, failures: [{ kind: "embedding", model: "embed-v4.0", class: "limit" }] }, ms: 50 };
  const results = kind === "none" ? [] : [{ provider_id: kind === "miss" ? "M009" : "M001", score: 0.8 }];
  const answer: SearchV1 = { v: 1, release_v: 7, query_lang: "en", status: results.length === 0 ? "no_clear_match" : "ok", emergency_first: kind === "emergency", results };
  return { answer, failure: null, observation: null, trace: NO_CALLS, ms: 100 };
}

function fakeEngine(script: (question: TestQuestion) => Asked): TuningEngine & { asked: string[] } {
  const seenIds: string[] = [];
  return {
    asked: seenIds,
    facts: { release: 7, model: "embed-v4.0", threshold: 0.3 },
    has: async () => true,
    plan: () => PLAN,
    ask: async (question) => {
      seenIds.push(question.id);
      return script(question);
    },
    usage: () => EMPTY_USAGE,
    close: async () => undefined,
  };
}

const QUESTIONS = [
  q("en-1"),
  q("en-2"),
  q("ur-1", { lang: "ur" }),
  q("ur-2", { lang: "ur" }),
  q("nm-1", { intent: "no_match", expected: [] }),
  q("em-1", { intent: "emergency" }),
  q("tune-1", { split: "tuning" }),
];
const noSleep = async () => undefined;

async function guard(args: string[], over: { bar?: unknown; engine?: ReturnType<typeof fakeEngine>; env?: Record<string, string | undefined>; deps?: Partial<GuardDeps> } = {}) {
  const root = tempDir();
  const out = path.join(root, "out");
  if (over.bar !== undefined) {
    mkdirSync(path.join(root, "data", "search-test-set"), { recursive: true });
    writeFileSync(path.join(root, "data", "search-test-set", "bar.json"), JSON.stringify(over.bar));
  }
  const engine = over.engine ?? fakeEngine((x) => asked(x.intent === "no_match" ? "none" : x.intent === "emergency" ? "emergency" : "hit"));
  const deps: GuardDeps = {
    loadQuestions: () => ({ questions: QUESTIONS.map((x, i) => ({ ...x, line: i + 1 })), errors: [], sha256: "b".repeat(64) }),
    makeEngine: vi.fn(async () => engine),
    monthUsage: vi.fn(async () => ({ calls: 0, tokens: 0 })),
    recordBelowBar: vi.fn(async () => undefined),
    usage: "USAGE",
    sleep: noSleep,
    ...over.deps,
  };
  const code = await runGuard(["guard", "--date", "2026-10-28", "--out-dir", out, "--summary-file", path.join(root, "summary.md"), ...args], over.env ?? SECRETS, root, deps);
  const summary = (() => {
    try {
      return readFileSync(path.join(root, "summary.md"), "utf8");
    } catch {
      return "";
    }
  })();
  const reports = (() => {
    try {
      return readdirSync(out);
    } catch {
      return [];
    }
  })();
  return { code, deps, engine, summary, out, reports };
}

describe("the guard's command line", () => {
  it("parses its options and refuses unknown ones", () => {
    expect(parseGuardOptions(["guard", "--yes"])).toMatchObject({ ok: true, options: { checkpoint: "pr", yes: true, maxCalls: 500 } });
    expect(parseGuardOptions(["guard", "--checkpoint", "week_4", "--plan-only", "--max-calls", "80"])).toMatchObject({ ok: true, options: { checkpoint: "week_4", planOnly: true, maxCalls: 80 } });
    expect(parseGuardOptions(["guard", "--checkpoint", "launch"]).ok).toBe(false);
    expect(parseGuardOptions(["guard", "--final"]).ok).toBe(false);
    expect(parseGuardOptions(["guard", "--yes", "--plan-only"]).ok).toBe(false);
  });

  it("with no bar yet, says so and passes without planning, connecting, reading the month or calling anything, even without secrets", async () => {
    const run = await guard(["--yes"], { env: {} });

    expect(run.code).toBe(0);
    expect(run.deps.makeEngine).not.toHaveBeenCalled();
    expect(run.deps.monthUsage).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("nothing is measured or called until the Hub approves a launch bar");
    expect(run.summary).toContain("Not measured: there is no data/search-test-set/bar.json yet");
  });

  it("with an unapproved bar, passes the same way", async () => {
    const run = await guard(["--yes"], { bar: { version: 1, approvedBy: null, approvedOn: null, minimums: { hitRate: {}, noMatchAccuracy: 0, emergencyAccuracy: 0 } } });
    expect(run.code).toBe(0);
    expect(run.deps.makeEngine).not.toHaveBeenCalled();
  });

  it("prints the plan for the evaluation subset only and, with --plan-only, stops there without a secret", async () => {
    const run = await guard(["--plan-only"], { bar: BAR, env: {} });

    expect(run.code).toBe(0);
    expect(run.deps.makeEngine).not.toHaveBeenCalled();
    const out = logs.join("\n");
    expect(out).toContain("6 evaluation questions");
    expect(out).toContain("Launch bar approved by Hub Director on 2026-10-20");
    expect(out).toContain("estimated usage:");
  });

  it("checks the usage allowance before the first call and refuses a run that would pass it, making no engine", async () => {
    const run = await guard(["--yes"], { bar: BAR, deps: { monthUsage: vi.fn(async () => ({ calls: 799, tokens: 0 })) } });

    expect(run.code).toBe(1);
    expect(run.deps.makeEngine).not.toHaveBeenCalled();
    expect(errs.join("\n")).toContain("past 800");
    expect(run.summary).toContain("Not run:");
  });

  it("passes when every minimum is met: it asks only the evaluation subset, with the translated-question leg on, and writes the report", async () => {
    const run = await guard(["--yes"], { bar: BAR });

    expect(run.code).toBe(0);
    expect(run.engine.asked.sort()).toEqual(["em-1", "en-1", "en-2", "nm-1", "ur-1", "ur-2"]);
    expect(run.deps.makeEngine).toHaveBeenCalledWith(expect.anything(), { translatedLeg: true });
    expect(run.reports).toEqual(["2026-10-28-embed-v4.0-guard-pr.json"]);
    const report = TestSetReportSchema.parse(JSON.parse(readFileSync(path.join(run.out, run.reports[0]!), "utf8")));
    expect(report.subsets.tuning).toBeNull();
    expect(report.subsets.evaluation?.overall.questions).toBe(6);
    expect(JSON.stringify(report)).not.toContain("text of");
    expect(run.summary).toContain("Every minimum of the launch bar is met.");
    expect(run.deps.recordBelowBar).not.toHaveBeenCalled();
  });

  it("fails a pull request whose search falls below the bar, naming each measure and the drop, and records no ops event (a branch is not what residents search)", async () => {
    const engine = fakeEngine((x) => asked(x.lang === "ur" && x.intent === "normal" ? "miss" : x.intent === "no_match" ? "none" : x.intent === "emergency" ? "emergency" : "hit"));
    const run = await guard(["--yes"], { bar: BAR, engine, env: { ...SECRETS, GITHUB_ACTIONS: "true" } });

    expect(run.code).toBe(1);
    expect(errs.join("\n")).toContain("::error title=Below the launch bar::hit rate (ur): 0.0%, below the minimum 70.0% by 70.0 points");
    expect(run.summary).toContain("- hit rate (ur): 0.0%, below the minimum 70.0% by 70.0 points");
    expect(run.deps.recordBelowBar).not.toHaveBeenCalled();
    for (const secret of Object.values(SECRETS)) expect(logs.join("\n") + errs.join("\n") + run.summary).not.toContain(secret.replace("https://", ""));
  });

  it("at a manual checkpoint, records each measure below its minimum for the weekly review, with the release it measured", async () => {
    const engine = fakeEngine((x) => asked(x.intent === "emergency" ? "hit" : x.intent === "no_match" ? "none" : "hit"));
    const run = await guard(["--yes", "--checkpoint", "week_4"], { bar: BAR, engine });

    expect(run.code).toBe(1);
    expect(run.deps.recordBelowBar).toHaveBeenCalledWith(expect.anything(), 7, "week_4", [{ measure: "emergency_accuracy", lang: null, observed: 0, minimum: 1 }]);
    expect(run.reports).toEqual(["2026-10-28-embed-v4.0-guard-week_4.json"]);
  });

  it("cannot pass on an incomplete measurement: a question without a usable answer fails the guard, and nothing is recorded", async () => {
    const engine = fakeEngine((x) => asked(x.id === "en-2" ? "limited" : x.intent === "no_match" ? "none" : x.intent === "emergency" ? "emergency" : "hit"));
    const run = await guard(["--yes", "--checkpoint", "pre_launch"], { bar: BAR, engine });

    expect(run.code).toBe(1);
    expect(errs.join("\n")).toContain("got no usable answer");
    expect(run.summary).toContain("Not judged");
    expect(run.deps.recordBelowBar).not.toHaveBeenCalled();
  });

  it("refuses a bar file that is not a bar instead of passing", async () => {
    const run = await guard(["--yes"], { bar: { version: 1, approvedBy: "x", approvedOn: "2026-10-20", minimums: { noMatchAccuracy: 5 } } });
    expect(run.code).toBe(1);
    expect(run.deps.makeEngine).not.toHaveBeenCalled();
  });
});
