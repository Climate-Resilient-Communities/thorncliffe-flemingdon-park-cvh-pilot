// The translation latency measurement (S04.01): the texts, the plan and its usage guard, the instrumented caller and
// the run against fakes, the report, the timeout rule, the failure listing, and the command line. No test calls Cohere.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CohereChatClient } from "@/modules/translation/adapters/cohereTranslator";
import {
  MODELS,
  PROVISIONAL_ROUTES,
  ReportSchema,
  attemptTimeoutSeconds,
  buildReport,
  checkGuard,
  checkOutput,
  checklistLines,
  classifyVendorError,
  createCohereCaller,
  failuresOverThreshold,
  mergeReports,
  parseReport,
  parseRoutes,
  parseTexts,
  planCalls,
  proposeTimeouts,
  routeDeadlineSeconds,
  runPlan,
  summarise,
  summarisePlan,
  timeoutsSql,
  type CallResult,
  type Caller,
  type LatencyReport,
  type PlannedCall,
  type ReportMeta,
  type Sample,
} from "../scripts/translation-latency/lib";
import { main } from "../scripts/translation-latency/main";

const ROOT = path.join(__dirname, "..");
const TEXTS = parseTexts(readFileSync(path.join(ROOT, "data", "translation-latency", "texts.json")));
const FIXTURE = path.join(ROOT, "test", "fixtures", "translation-latency", "smoke-run-example.json");
const { commandATranslate: CMD, northSmallTranslate: NORTH, tinyAyaFire: FIRE, tinyAyaWater: WATER } = MODELS;
const temp: string[] = [];
afterAll(() => temp.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "latency-"));
  temp.push(dir);
  return dir;
};

const sample = (over: Partial<Sample> = {}): Sample => ({
  lang: "es",
  model: CMD,
  position: 1,
  text_id: "ack-power",
  rep: 1,
  key_var: "COHERE_API_KEY",
  outcome: "ok",
  ms: 1000,
  input_tokens: 50,
  output_tokens: 40,
  ...over,
});

const meta = (over: Partial<ReportMeta> = {}): ReportMeta => ({
  date: "2026-10-02",
  startedAt: "2026-10-02T12:00:00.000Z",
  finishedAt: "2026-10-02T12:01:00.000Z",
  maxOutputTokens: 1024,
  callTimeoutMs: 60000,
  textsSha256: TEXTS.sha256,
  textIds: ["ack-power"],
  repetitions: 1,
  routes: { es: [CMD, NORTH] },
  plannedCalls: 1,
  ...over,
});

describe("the representative texts", () => {
  it("are 10 short acknowledgements and 10 full alerts of 300 to 600 characters", () => {
    const acks = TEXTS.texts.filter((t) => t.kind === "ack");
    const alerts = TEXTS.texts.filter((t) => t.kind === "alert");
    expect(acks).toHaveLength(10);
    expect(alerts).toHaveLength(10);
    for (const a of acks) expect(a.text.length).toBeLessThan(300);
    for (const a of alerts) {
      expect(a.text.length).toBeGreaterThanOrEqual(300);
      expect(a.text.length).toBeLessThanOrEqual(600);
    }
  });
});

describe("the plan and the usage guard", () => {
  const sel = { routes: PROVISIONAL_ROUTES, repetitions: 3, keyVar: "COHERE_API_KEY" };

  it("counts every text x language x model in its route x 3, per key and model", () => {
    const calls = planCalls(TEXTS.texts, sel);
    expect(calls).toHaveLength(1620);
    const byModel = Object.fromEntries(summarisePlan(calls).map((r) => [r.model, r.calls]));
    // Command A Translate: el, hi, zh, es, fr first, prs second; North Small Translate: all 14; Fire: 5; Water: 2.
    expect(byModel).toEqual({ [CMD]: 6 * 60, [NORTH]: 14 * 60, [FIRE]: 5 * 60, [WATER]: 2 * 60 });
  });

  it("narrows by language, model, route position, text and repetitions, and names each model's key", () => {
    const calls = planCalls(TEXTS.texts, {
      ...sel,
      langs: ["es", "ur"],
      positions: [1],
      textIds: ["ack-power"],
      repetitions: 1,
      keyVarFor: { [NORTH]: "COHERE_API_KEY2" },
    });
    expect(calls.map((c) => [c.lang, c.model, c.keyVar])).toEqual([
      ["es", CMD, "COHERE_API_KEY"],
      ["ur", NORTH, "COHERE_API_KEY2"],
    ]);
    expect(planCalls(TEXTS.texts, { ...sel, langs: ["es"], models: [NORTH], repetitions: 2 })).toHaveLength(40);
    expect(() => planCalls(TEXTS.texts, { ...sel, textIds: ["nope"] })).toThrow(/no text/);
  });

  it("refuses without a ceiling, and when any key and model plans more than it", () => {
    const rows = summarisePlan(planCalls(TEXTS.texts, sel));
    expect(checkGuard(rows, undefined)[0]).toMatch(/required/);
    expect(checkGuard(rows, 0)[0]).toMatch(/at least 1/);
    expect(checkGuard(rows, 840)).toEqual([]);
    expect(checkGuard(rows, 839)).toEqual([`${NORTH} on COHERE_API_KEY plans 840 calls, more than --max-calls-per-model 839`]);
    expect(checkGuard(rows, 300)).toHaveLength(2);
  });

  it("reads a routes file and refuses English or zh-Hant in it", () => {
    expect(parseRoutes(JSON.stringify({ ps: [NORTH] }))).toEqual({ ps: [NORTH] });
    expect(() => parseRoutes(JSON.stringify({ en: [CMD] }))).toThrow(/not translated/);
    expect(() => parseRoutes(JSON.stringify({ xx: [CMD] }))).toThrow(/not valid/);
  });
});

describe("percentiles", () => {
  it("are nearest-rank over the answered calls only", () => {
    const samples = Array.from({ length: 100 }, (_, i) => sample({ rep: i + 1, ms: i + 1 }));
    samples.push(sample({ rep: 101, ms: 60000, outcome: "timeout" }), sample({ rep: 102, ms: 5, outcome: "rate_limited" }));
    const [row] = summarise(samples, { es: [CMD] });
    expect(row!.latency_ms).toEqual({ n: 100, p50: 50, p95: 95, p99: 99, max: 100 });
    expect(row!.attempts).toBe(102);
    expect(row!.failures).toBe(1);
    expect(row!.rate_limited).toBe(1);
  });

  it("make p99 of 60 samples the slowest one", () => {
    const samples = Array.from({ length: 60 }, (_, i) => sample({ rep: i + 1, ms: 1000 + i * 10 }));
    const [row] = summarise(samples, { es: [CMD] });
    expect(row!.latency_ms.p99).toBe(1590);
    expect(row!.latency_ms.p95).toBe(1560); // the 57th of 60
    expect(row!.latency_ms.p50).toBe(1290); // the 30th
  });

  it("count usage per language and model", () => {
    const [row] = summarise([sample(), sample({ rep: 2, input_tokens: null, output_tokens: null, outcome: "error" })], { es: [CMD] });
    expect(row!.usage).toEqual({ calls: 2, input_tokens: 50, output_tokens: 40, calls_without_token_counts: 1 });
  });
});

describe("the output check", () => {
  it("catches empty answers and answers mostly outside the language's script", () => {
    expect(checkOutput("ur", "  ")).toBe("empty");
    expect(checkOutput("ur", "بجلی بند ہے۔ Toronto Hydro")).toBe("ok");
    expect(checkOutput("ur", "Power is out on floors 1 to 6.")).toBe("wrong_script");
    expect(checkOutput("zh", "停电了")).toBe("ok");
    expect(checkOutput("es", "La luz se ha ido.")).toBe("ok");
  });
});

// A vendor client that answers by script. `behave` decides each call.
function fakeClient(behave: (request: { model: string; maxTokens: number }, signal: AbortSignal) => Promise<unknown>) {
  const requests: { model: string; maxTokens: number }[] = [];
  const client: CohereChatClient = {
    v2: {
      chat: (request, options) => {
        requests.push({ model: request.model, maxTokens: request.maxTokens });
        return behave(request, options.abortSignal) as ReturnType<CohereChatClient["v2"]["chat"]>;
      },
    },
  };
  return { client, requests };
}
const answer = (text: string) => Promise.resolve({ message: { content: [{ type: "text", text }] }, usage: { billedUnits: { inputTokens: 30, outputTokens: 20 } } });
const vendorError = (statusCode: number, message: string) => Promise.reject(Object.assign(new Error(message), { statusCode, body: { message } }));
const call = (over: Partial<PlannedCall> = {}): PlannedCall => ({ lang: "ur", model: NORTH, position: 1, textId: "ack-power", rep: 1, keyVar: "K", ...over });

describe("the instrumented caller (the app's adapter around a fake vendor client)", () => {
  it("measures an answer, asks for the alert-length answer, and checks the script", async () => {
    let t = 0;
    const { client, requests } = fakeClient(() => {
      t += 812;
      return answer("بجلی بند ہے");
    });
    const caller = createCohereCaller({ clientFor: () => client, maxOutputTokens: 1024, callTimeoutMs: 1000, now: () => t });
    expect(await caller(call(), "Power is out.")).toEqual({ outcome: "ok", ms: 812, inputTokens: 30, outputTokens: 20 });
    expect(requests).toEqual([{ model: NORTH, maxTokens: 1024 }]);
    expect((await caller(call({ lang: "ur" }), "x")).outcome).toBe("ok");
  });

  it("tells a per-month 429 from a per-minute 429 and a rejected key, and never keeps the vendor's message", async () => {
    const cases: [() => Promise<unknown>, string][] = [
      [() => vendorError(429, "You have exceeded your per-month request limit for this model"), "quota_exhausted"],
      [() => vendorError(429, "too many requests, retry in 1 minute"), "rate_limited"],
      [() => vendorError(401, "invalid api token"), "auth_failed"],
      [() => vendorError(500, "internal error"), "error"],
      [() => answer("Power is out"), "wrong_script"],
      [() => answer(""), "empty"],
    ];
    for (const [reply, outcome] of cases) {
      const { client } = fakeClient(reply);
      const result = await createCohereCaller({ clientFor: () => client, maxOutputTokens: 64, callTimeoutMs: 1000 })(call(), "Power is out.");
      expect(result.outcome).toBe(outcome);
      expect(JSON.stringify(result)).not.toMatch(/request limit|api token|internal error|retry/);
    }
    expect(classifyVendorError({ statusCode: 429, body: "monthly limit" })).toEqual({ status: 429, monthlyQuota: true });
    expect(classifyVendorError(new Error("socket hang up"))).toEqual({ status: null, monthlyQuota: false });
  });

  it("counts a call still unanswered at the call timeout as a timeout", async () => {
    const { client } = fakeClient(
      (_request, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    const result = await createCohereCaller({ clientFor: () => client, maxOutputTokens: 64, callTimeoutMs: 20 })(call(), "x");
    expect(result.outcome).toBe("timeout");
  });
});

describe("the run", () => {
  const texts = new Map(TEXTS.texts.map((t) => [t.id, t.text]));
  const scripted =
    (outcomes: Record<string, CallResult["outcome"][]>): Caller & { made: PlannedCall[] } => {
      const made: PlannedCall[] = [];
      const fn: Caller = async (c) => {
        made.push(c);
        const outcome = outcomes[c.model]?.shift() ?? "ok";
        return { outcome, ms: 100, inputTokens: 1, outputTokens: 1 };
      };
      return Object.assign(fn, { made });
    };

  it("stops a model at its first per-month 429 and carries on with the others", async () => {
    const calls = planCalls(TEXTS.texts, { routes: { ur: [NORTH, FIRE] }, textIds: ["ack-power", "ack-water", "ack-fire"], repetitions: 1, keyVar: "K" });
    const caller = scripted({ [NORTH]: ["ok", "quota_exhausted"] });
    const { samples, stopped } = await runPlan(calls, texts, caller, { maxCallsPerModel: 10 });
    expect(caller.made.filter((c) => c.model === NORTH)).toHaveLength(2);
    expect(caller.made.filter((c) => c.model === FIRE)).toHaveLength(3);
    expect(stopped).toEqual([{ key_var: "K", model: NORTH, reason: "quota_exhausted", skipped: 1 }]);
    expect(samples.filter((s) => s.outcome === "quota_exhausted")).toHaveLength(1);
  });

  it("stops every model on a rejected key, and never passes the ceiling", async () => {
    const calls = planCalls(TEXTS.texts, { routes: { ur: [NORTH, FIRE] }, textIds: ["ack-power", "ack-water"], repetitions: 1, keyVar: "K" });
    const rejected = scripted({ [NORTH]: ["auth_failed"] });
    expect((await runPlan(calls, texts, rejected, { maxCallsPerModel: 10 })).samples).toHaveLength(1);
    const capped = scripted({});
    const { stopped } = await runPlan(calls, texts, capped, { maxCallsPerModel: 1 });
    expect(capped.made).toHaveLength(2);
    expect(stopped.map((s) => s.reason)).toEqual(["ceiling", "ceiling"]);
  });
});

describe("the report", () => {
  it("is valid against its schema, holds no text, and is complete only when every planned call was made", () => {
    const report = buildReport(meta(), { samples: [sample()], stopped: [] });
    expect(ReportSchema.parse(report)).toEqual(report);
    expect(report.complete).toBe(true);
    expect(JSON.stringify(report)).not.toContain(TEXTS.texts[0]!.text);
    expect(buildReport(meta({ plannedCalls: 2 }), { samples: [sample()], stopped: [] }).complete).toBe(false);
    expect(() => ReportSchema.parse({ ...report, text: "x" })).toThrow();
  });

  it("parses the committed smoke-run example", () => {
    const example = parseReport(readFileSync(FIXTURE, "utf8"));
    expect(example.results.length).toBeGreaterThan(0);
  });

  it("merges partial runs, refusing a call measured twice or different texts", () => {
    const a = buildReport(meta(), { samples: [sample()], stopped: [] });
    const b = buildReport(meta({ routes: { ur: [NORTH] } }), { samples: [sample({ lang: "ur", model: NORTH })], stopped: [] });
    const merged = mergeReports([a, b], "2026-11-02");
    expect(merged.results.map((r) => `${r.lang} ${r.model}`)).toEqual([`es ${CMD}`, `ur ${NORTH}`]);
    expect(merged.planned_calls).toBe(2);
    expect(merged.complete).toBe(true);
    expect(() => mergeReports([a, a], "2026-11-02")).toThrow(/more than one report/);
    expect(() => mergeReports([a, { ...b, texts: { ...b.texts, sha256: "0".repeat(64) } }], "2026-11-02")).toThrow(/different texts/);
  });
});

describe("failures over 2 in 60", () => {
  const rows = (failures: number, attempts = 60, rateLimited = 0) =>
    summarise(
      Array.from({ length: attempts }, (_, i) =>
        sample({ rep: i + 1, outcome: i < failures ? "timeout" : i < failures + rateLimited ? "rate_limited" : "ok" }),
      ),
      { es: [CMD] },
    );

  it("lists a model that failed 3 of 60 but not 2 of 60, with the language and the action", () => {
    expect(failuresOverThreshold(rows(2))).toEqual([]);
    const flagged = failuresOverThreshold(rows(3));
    expect(flagged).toEqual([{ lang: "es", model: CMD, failures: 3, attempts: 60, action: "reorder the route or accept fallback" }]);
    expect(checklistLines(flagged)).toEqual([`- [ ] Translation: ${CMD} failed 3 of 60 attempts for es; action: reorder the route or accept fallback.`]);
  });

  it("does not count the key's limits as attempts", () => {
    // 2 failures of 40 real attempts (20 cut short by a 429) is over 1 in 30.
    expect(failuresOverThreshold(rows(2, 60, 20))).toHaveLength(1);
  });
});

describe("the timeout rule", () => {
  it("is p99 x 1.25 rounded up to the next second, at most 20 s", () => {
    expect(attemptTimeoutSeconds(1600)).toBe(2);
    expect(attemptTimeoutSeconds(1600.1)).toBe(3);
    expect(attemptTimeoutSeconds(2401)).toBe(4);
    expect(attemptTimeoutSeconds(0)).toBe(1);
    expect(attemptTimeoutSeconds(16000)).toBe(20);
    expect(attemptTimeoutSeconds(16001)).toBe(20);
    expect(() => attemptTimeoutSeconds(Number.NaN)).toThrow();
  });

  it("makes each route deadline the sum of its attempt timeouts, at most 30 s", () => {
    expect(routeDeadlineSeconds([3, 4])).toBe(7);
    expect(routeDeadlineSeconds([20, 20])).toBe(30);
  });

  it("proposes per-(language, model) values from a report, and names what it could not measure", () => {
    const report = buildReport(meta({ routes: { es: [CMD, NORTH], ps: [NORTH] }, plannedCalls: 4 }), {
      samples: [sample({ ms: 2000 }), sample({ model: NORTH, position: 2, ms: 17000 }), sample({ model: NORTH, position: 2, rep: 2, ms: 900 })],
      stopped: [],
    });
    const proposal = proposeTimeouts(report, { es: [CMD, NORTH], ps: [NORTH] });
    expect(proposal.positions.map((p) => [p.lang, p.model, p.attempt_timeout_s, p.capped])).toEqual([
      ["es", CMD, 3, false],
      ["es", NORTH, 20, true],
    ]);
    expect(proposal.deadlines).toEqual([{ lang: "es", sum_s: 23, route_deadline_s: 23, capped: false }]);
    expect(proposal.missing).toEqual([{ lang: "ps", model: NORTH, position: 1 }]);
    expect(proposal.thin).toHaveLength(2);

    const sql = timeoutsSql(proposal, report);
    expect(sql).toContain(`('es', '${CMD}', 3000)`);
    expect(sql).toContain(`('es', '${NORTH}', 20000)`);
    expect(sql).toContain("UPDATE translation_route AS r");
    expect(sql).toContain("IF updated <> 2 THEN");
    expect(timeoutsSql(proposal, report, { table: "translation_route", langColumn: "lang", modelColumn: "model_id", timeoutColumn: "attempt_timeout_s", unit: "s" })).toContain(`('es', '${CMD}', 3)`);
    expect(() => timeoutsSql(proposal, report, { table: "x; drop", langColumn: "a", modelColumn: "b", timeoutColumn: "c", unit: "s" })).toThrow(/identifier/);
  });
});

describe("the command line", () => {
  const capture = () => {
    const lines: string[] = [];
    return { lines, log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };
  };

  it("prints the plan and makes no call on --dry-run, and refuses to start without a ceiling", async () => {
    let clients = 0;
    const io = capture();
    const deps = { ...io, clientFor: () => ((clients++, fakeClient(() => answer("x")).client)) };
    expect(await main(["run", "--dry-run"], {}, ROOT, deps)).toBe(0);
    expect(io.lines[0]).toBe("Plan: 20 text(s) x 3 repetition(s), 1620 call(s) in all");
    const out = path.join(tempDir(), "r.json");
    expect(await main(["run", "--langs", "es", "--out", out], { COHERE_API_KEY: "k" }, ROOT, deps)).toBe(2);
    expect(io.lines.join("\n")).toMatch(/max-calls-per-model <n> is required/);
    expect(await main(["run", "--langs", "es", "--out", out, "--max-calls-per-model", "39"], { COHERE_API_KEY: "k" }, ROOT, deps)).toBe(2);
    expect(clients).toBe(0);
    expect(existsSync(out)).toBe(false);
  });

  it("keeps the dated file for the full measurement", async () => {
    const io = capture();
    expect(await main(["run", "--langs", "es", "--max-calls-per-model", "100"], { COHERE_API_KEY: "k" }, ROOT, io)).toBe(2);
    expect(io.lines.join("\n")).toMatch(/subset run needs --out/);
  });

  it("runs a subset against a fake client, writes a valid report, and turns it into timeouts", async () => {
    const dir = tempDir();
    const out = path.join(dir, "smoke.json");
    const keysSeen: string[] = [];
    const io = capture();
    const deps = {
      ...io,
      clientFor: (key: string) => {
        keysSeen.push(key);
        return fakeClient((request) => (request.model === NORTH ? answer("بجلی بند ہے") : answer("Se fue la luz."))).client;
      },
    };
    const argv = ["run", "--langs", "es,ur", "--positions", "1", "--texts", "ack-power", "--reps", "1", "--out", out, "--max-calls-per-model", "1", "--key-var-for", `${NORTH}=COHERE_API_KEY2`];
    expect(await main(argv, { COHERE_API_KEY: "one", COHERE_API_KEY2: "two" }, ROOT, deps)).toBe(0);
    expect(keysSeen.sort()).toEqual(["one", "two"]);
    const report: LatencyReport = parseReport(readFileSync(out, "utf8"));
    expect(report.complete).toBe(true);
    expect(report.key_vars).toEqual(["COHERE_API_KEY", "COHERE_API_KEY2"]);
    expect(JSON.stringify(report)).not.toMatch(/"one"|"two"/);
    expect(existsSync(`${out}.samples.jsonl`)).toBe(false);

    // Only first choices were measured: the SQL is refused unless the gaps are accepted, or the routes narrowed.
    const refused = capture();
    expect(await main(["timeouts", out, "--sql"], {}, ROOT, refused)).toBe(1);
    expect(refused.lines.join("\n")).toMatch(/MISSING: no answered call for es position 2/);
    const sqlIo = capture();
    expect(await main(["timeouts", out, "--sql", "--allow-missing"], {}, ROOT, sqlIo)).toBe(0);
    expect(sqlIo.lines.join("\n")).toContain("IF updated <> 2 THEN");
    const narrowed = capture();
    expect(await main(["timeouts", out, "--sql", "--routes", writeRoutes(dir)], {}, ROOT, narrowed)).toBe(0);
    expect(narrowed.lines.join("\n")).toContain("IF updated <> 1 THEN");
  });
});

function writeRoutes(dir: string): string {
  const file = path.join(dir, "routes.json");
  writeFileSync(file, JSON.stringify({ es: [CMD] }));
  return file;
}
