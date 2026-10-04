// The search probe shared by the production smoke check and the daily latency workflow (scripts/ci/search-probe.mjs),
// against a fake fetch: nothing here reaches a real site or Cohere.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { SearchV1Schema } from "@/contracts/searchTestSet";
import { parseSearchRequest } from "@/contracts/search";
import {
  SEARCH_QUESTION,
  answerProblem,
  askSearch,
  latencyBudgetMs,
  runProbe,
  searchSmokeEnabled,
  serverTimingTotal,
  timingLines,
} from "../scripts/ci/search-probe.mjs";

const OK = { v: 1, release_v: 3, query_lang: "en", status: "ok", emergency_first: false, results: [{ provider_id: "p1", score: 0.9 }] };

/** A fake fetch that answers like the search route and takes `ms` of a fake clock. */
function fake(body: unknown, { status = 200, timing = "limiter;dur=12.3, embed;dur=210, total;dur=480.5", ms = 600 } = {}) {
  let clock = 0;
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = async (url: URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    clock += ms;
    return new Response(JSON.stringify(body), { status, headers: { "server-timing": timing } });
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => clock, calls };
}

describe("serverTimingTotal", () => {
  it.each([
    ["boot;dur=1, total;dur=480.5", 480.5],
    ["total;dur=12", 12],
    ["snapshot;dur=40;desc=cold, total;dur=900.1", 900.1],
    ["total;desc=x;dur=7", 7],
    ["limiter;dur=12", null],
    ["total", null],
    ["total;dur=abc", null],
    ["total;dur=", null],
    ["total;dur=-5", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])("reads %j as %j", (header, expected) => {
    expect(serverTimingTotal(header as string | null | undefined)).toBe(expected);
  });

  it("reads what the app writes", async () => {
    const { formatServerTiming } = await import("@/platform/serverTiming");

    const header = formatServerTiming([
      { phase: "limiter", ms: 12.34 },
      { phase: "snapshot", ms: 80, flag: "cold" },
      { phase: "total", ms: 1234.56 },
    ]);

    expect(serverTimingTotal(header)).toBe(1234.6);
  });
});

describe("the fixed question", () => {
  it("is a valid English search request and a good answer is a valid SearchV1", () => {
    expect(parseSearchRequest({ q: SEARCH_QUESTION, lang: "en" })).toEqual({ ok: true, value: { q: SEARCH_QUESTION, lang: "en" } });
    expect(SearchV1Schema.safeParse(OK).success).toBe(true);
  });

  it("is judged: 200, status ok and at least one result", () => {
    expect(answerProblem(200, OK)).toBeNull();
    expect(answerProblem(503, { error: { code: "search_unavailable" } })).toMatch(/HTTP 503/);
    expect(answerProblem(429, null)).toMatch(/HTTP 429/);
    expect(answerProblem(200, { ...OK, status: "no_clear_match" })).toMatch(/status "no_clear_match"/);
    expect(answerProblem(200, { ...OK, status: "unavailable", results: [] })).toMatch(/status "unavailable"/);
    expect(answerProblem(200, { ...OK, results: [] })).toMatch(/no result/);
    expect(answerProblem(200, null)).toMatch(/status "undefined"/);
  });
});

describe("the switch and the budget", () => {
  it("is on unless SMOKE_SEARCH says off", () => {
    expect(searchSmokeEnabled(undefined)).toBe(true);
    expect(searchSmokeEnabled("")).toBe(true);
    expect(searchSmokeEnabled("on")).toBe(true);
    expect(searchSmokeEnabled("off")).toBe(false);
    expect(searchSmokeEnabled(" OFF ")).toBe(false);
  });

  it("defaults to 3000 ms and rejects a budget that is not a positive number", () => {
    expect(latencyBudgetMs(undefined)).toBe(3000);
    expect(latencyBudgetMs("")).toBe(3000);
    expect(latencyBudgetMs("1500")).toBe(1500);
    for (const bad of ["0", "-1", "fast", "NaN"]) expect(() => latencyBudgetMs(bad), bad).toThrow(/SEARCH_LATENCY_BUDGET_MS/);
  });
});

describe("askSearch and runProbe", () => {
  it("posts the fixed question in English to /api/search and measures the response and the Server-Timing total", async () => {
    const f = fake(OK);

    const result = await askSearch("https://example.org/some/path", f);

    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe("https://example.org/api/search");
    expect(f.calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ q: SEARCH_QUESTION, lang: "en" });
    expect(result).toMatchObject({ httpStatus: 200, responseMs: 600, totalMs: 480.5 });
  });

  it("passes inside the budget", async () => {
    const outcome = await runProbe({ PRODUCTION_URL: "https://example.org", SEARCH_LATENCY_BUDGET_MS: "3000" }, fake(OK));

    expect(outcome.problems).toEqual([]);
    expect(outcome.lines.join("\n")).toMatch(/Response time.*600 \(budget 3000 ms\)/);
    expect(outcome.lines.join("\n")).toMatch(/Server-Timing total \| 481 \(budget 3000 ms\)/);
  });

  it("fails with a clear message when the response time is over the budget", async () => {
    const outcome = await runProbe({ PRODUCTION_URL: "https://example.org", SEARCH_LATENCY_BUDGET_MS: "500" }, fake(OK, { timing: "total;dur=100" }));

    expect(outcome.problems).toEqual(["Search took 600 ms to answer, over the 500 ms budget."]);
  });

  it("fails when the Server-Timing total is over the budget, even if the response was quick", async () => {
    const outcome = await runProbe({ PRODUCTION_URL: "https://example.org", SEARCH_LATENCY_BUDGET_MS: "400" }, fake(OK, { ms: 100, timing: "total;dur=480.5" }));

    expect(outcome.problems).toEqual(["Search reported a Server-Timing total of 481 ms, over the 400 ms budget."]);
  });

  it("uses 3000 ms when no budget is set, and tolerates a missing Server-Timing header", async () => {
    const outcome = await runProbe({ PRODUCTION_URL: "https://example.org" }, fake(OK, { timing: "", ms: 3500 }));

    expect(outcome.problems).toEqual(["Search took 3500 ms to answer, over the 3000 ms budget."]);
    expect(outcome.lines.join("\n")).toContain("not reported");
  });

  it("fails when the search does not answer well", async () => {
    const outcome = await runProbe({ PRODUCTION_URL: "https://example.org" }, fake({ error: { code: "search_unavailable" } }, { status: 503 }));

    expect(outcome.problems).toEqual(["Search answered HTTP 503, not 200."]);
  });

  it("fails when there is no https PRODUCTION_URL, without sending anything", async () => {
    const f = fake(OK);

    for (const url of [undefined, "", "http://example.org", "example.org"]) {
      const outcome = await runProbe({ PRODUCTION_URL: url }, f);
      expect(outcome.problems).toEqual(["The repository variable PRODUCTION_URL is missing or is not a full https:// URL."]);
    }
    expect(f.calls).toEqual([]);
  });

  it("writes timing lines for the job summary", () => {
    expect(timingLines("Search smoke", { responseMs: 12.4, totalMs: null })).toEqual([
      "## Search smoke",
      "",
      "| Measure | Milliseconds |",
      "|---|---|",
      "| Response time, as the client saw it | 12 |",
      "| Server-Timing total | not reported |",
      "",
    ]);
  });
});

describe("the latency probe's command", () => {
  const cli = (env: Record<string, string>) =>
    spawnSync("node", [path.join(__dirname, "..", "scripts", "ci", "search-latency.mjs")], { encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env } });

  it("sends nothing and succeeds when SMOKE_SEARCH is off", () => {
    const result = cli({ SMOKE_SEARCH: "off", PRODUCTION_URL: "https://127.0.0.1:9" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SMOKE_SEARCH is off");
  });

  it("fails with an annotation when PRODUCTION_URL is not set or the budget is not a number", () => {
    const missing = cli({});
    const budget = cli({ PRODUCTION_URL: "https://127.0.0.1:9", SEARCH_LATENCY_BUDGET_MS: "fast" });

    expect(missing.status).toBe(1);
    expect(missing.stdout).toMatch(/::error title=Search latency probe failed::The repository variable PRODUCTION_URL/);
    expect(budget.status).toBe(1);
    expect(budget.stdout).toMatch(/::error title=Search latency probe failed::SEARCH_LATENCY_BUDGET_MS must be/);
  });
});

describe("where the one real search runs", () => {
  const read = (file: string) => readFileSync(path.join(__dirname, "..", file), "utf8");

  it("skips in the smoke spec unless SMOKE_SEARCH is on, so the checks' build and previews never spend a Cohere call", () => {
    const spec = read("e2e/smoke.spec.ts");

    expect(spec).toMatch(/test\.skip\(process\.env\.SMOKE_SEARCH !== "on"/);
    expect(spec).toContain('lang: "en"');
  });

  it("is a daily, alert-only probe that reads the public site without a secret or an environment", () => {
    const text = read(".github/workflows/search-latency.yml");
    const workflow = parse(text);

    expect(workflow.on.schedule).toHaveLength(1);
    expect(text).not.toMatch(/secrets\.|environment:|vercel/i);
    expect(workflow.permissions).toEqual({ contents: "read" });
    const step = workflow.jobs.probe.steps.at(-1);
    expect(step.run).toBe("node scripts/ci/search-latency.mjs");
    expect(Object.keys(step.env).sort()).toEqual(["PRODUCTION_URL", "SEARCH_LATENCY_BUDGET_MS", "SMOKE_SEARCH"]);
  });
});
