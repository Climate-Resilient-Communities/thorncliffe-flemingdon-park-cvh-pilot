// .github/workflows/search-guard.yml and scripts/ci/search-guard-scope.sh (S03.09): a pull request that changes what search depends on is
// measured against the launch bar; one that does not is answered in seconds by git alone, with no install and no secret; nothing is
// measured (or called) before a bar exists; the measuring job never runs a fork's or Dependabot's code with the secrets, holds them in
// one step, and waits in its own environment for the owner; the checkpoint runs from main only, in production's environment, and
// shares the key's concurrency group with the "Search test set" workflow. The scope script is run on a real git repository here.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseGuardOptions } from "../scripts/search-test-set/guard";

const root = path.join(__dirname, "..");
const text = readFileSync(path.join(root, ".github", "workflows", "search-guard.yml"), "utf8");
const workflow = parse(text);
const SCOPE = path.join(root, "scripts", "ci", "search-guard-scope.sh");
const RULES = readFileSync(path.join(root, "scripts", "ci", "search-guard-paths.txt"), "utf8");

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string | boolean | number>;
}
const stepsOf = (job: string): Step[] => workflow.jobs[job].steps;
const secretSteps = (job: string) => stepsOf(job).filter((s) => JSON.stringify(s.env ?? {}).includes("secrets."));

describe("the search guard workflow", () => {
  it("runs on pull requests and by hand, read-only, and no job adds a permission or uses the token", () => {
    expect(workflow.on.pull_request.types).toEqual(["opened", "synchronize", "reopened", "ready_for_review"]);
    expect(Object.keys(workflow.on)).toEqual(["pull_request", "workflow_dispatch"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(workflow.jobs) as { permissions?: unknown }[]) expect(job.permissions).toBeUndefined();
    expect(text).not.toMatch(/GITHUB_TOKEN|github\.token/);
  });

  it("decides the scope in seconds with git alone: no environment, no secret, no install", () => {
    const scope = workflow.jobs.scope;
    expect(scope.name).toBe("Search guard");
    expect(scope.if).toBe("github.event_name == 'pull_request'");
    expect(scope.environment).toBeUndefined();
    expect(scope["timeout-minutes"]).toBeLessThanOrEqual(5);
    expect(JSON.stringify(scope)).not.toMatch(/secrets\.|npm ci|setup-node/);
    expect(stepsOf("scope").find((s) => s.uses?.startsWith("actions/checkout"))!.with).toMatchObject({ "fetch-depth": 0, "persist-credentials": false });
    expect(stepsOf("scope").at(-1)!.run).toBe('scripts/ci/search-guard-scope.sh "$BASE_SHA" "$HEAD_SHA"');
  });

  it("measures only what the scope says, never for a fork or Dependabot, in its own environment, with the secrets in one step", () => {
    const measure = workflow.jobs.measure;
    expect(measure.needs).toBe("scope");
    expect(measure.if).toContain("needs.scope.outputs.measure == 'true'");
    expect(measure.if).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(measure.if).toContain("github.event.pull_request.user.login != 'dependabot[bot]'");
    expect(measure.environment).toBe("search-guard");
    expect(measure.concurrency).toEqual({ group: "search-guard-${{ github.event.pull_request.number }}", "cancel-in-progress": false });
    // The secrets themselves are in the run step only; the check before it sees only whether each is set.
    expect(secretSteps("measure").map((s) => s.name)).toEqual(["Check the search-guard environment has what the run needs", "Measure the evaluation subset against the launch bar"]);
    for (const value of Object.values(secretSteps("measure")[0]!.env!)) expect(value).toMatch(/!= ''/);
    const npmIndex = stepsOf("measure").findIndex((s) => s.run === "npm ci");
    expect(JSON.stringify(stepsOf("measure")[npmIndex])).not.toContain("secrets.");
  });

  it("judges a pull request by the base branch's bar, and runs the guard with options its command line accepts", () => {
    expect(stepsOf("measure").find((s) => s.name === "Take the base branch's launch bar")!.run).toBe('git show "$BASE_SHA:data/search-test-set/bar.json" > "$RUNNER_TEMP/bar.json"');
    const run = stepsOf("measure").find((s) => s.name === "Measure the evaluation subset against the launch bar")!.run!;
    const command = run.split("\n").find((line) => line.includes("npm run search-test-set"))!.trim();
    expect(command).toContain("guard --checkpoint pr --bar");
    const args = command
      .replace(/^npm run search-test-set -- /, "")
      .replaceAll('"$RUNNER_TEMP/bar.json"', "/tmp/bar.json")
      .replaceAll('"$out/report"', "/tmp/out")
      .replaceAll('"$out/summary.md"', "/tmp/summary.md")
      .split(" ");
    expect(parseGuardOptions(args)).toMatchObject({ ok: true, options: { checkpoint: "pr", yes: true, bar: "/tmp/bar.json" } });
  });

  it("runs the checkpoint by hand from main only, in the production environment, sharing the key's group with the Search test set workflow, inputs as environment variables only", () => {
    const checkpoint = workflow.jobs.checkpoint;
    expect(checkpoint.if).toBe("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
    expect(checkpoint.environment).toBe("production");
    expect(checkpoint.concurrency).toEqual({ group: "search-test-set", "cancel-in-progress": false });
    expect(workflow.on.workflow_dispatch.inputs.checkpoint.options).toEqual(["pre_launch", "week_4", "manual"]);
    expect(secretSteps("checkpoint").map((s) => s.name)).toEqual(["Check the production environment has what the run needs", "Run the checkpoint"]);
    for (const step of stepsOf("checkpoint")) expect(step.run ?? "").not.toContain("${{ inputs.");
    expect(stepsOf("checkpoint").find((s) => s.name === "Write the summary")!.run).toContain("gh run download");
  });
});

describe("what can change search", () => {
  const rules = RULES.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("#"));
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n");

  it("names files that exist, and no test", () => {
    for (const rule of rules) {
      const pattern = new RegExp(rule.split(" ")[0]!);
      expect(tracked.filter((file) => pattern.test(file)), rule).not.toHaveLength(0);
      expect(tracked.filter((file) => pattern.test(file) && /\.test\./.test(file)), rule).toEqual([]);
    }
  });

  it("covers the catalogue, the embedding model, the threshold, emergency_categories and search_question_route", () => {
    for (const file of ["data/catalogue/providers.json", "src/modules/directory/application/search.ts", "src/modules/translation/application/questionTranslator.ts", "src/platform/config/env.ts"]) {
      expect(rules.some((rule) => new RegExp(rule.split(" ")[0]!).test(file)), file).toBe(true);
    }
    const envRule = rules.find((rule) => rule.startsWith("^src/platform/config/env"))!.split(" ").slice(1).join(" ");
    for (const line of ["+  embedModel: \"embed-v5.0\",", "-  threshold: 0.3,", "+  ps: \"command-a-translate-08-2025\", // DEFAULT_QUESTION_ROUTE", "+ SEARCH_EMERGENCY_CATEGORIES", "+  emergencyCategories: [\"Health\"],"]) {
      expect(new RegExp(envRule).test(line), line).toBe(true);
    }
    expect(new RegExp(envRule).test("+  smsSegmentsPerSecond: 3,")).toBe(false);
  });
});

describe("the scope script, on a real repository", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  /** A repository with the rules and a few files on main, and a branch made by `change`. */
  function repo(options: { bar?: unknown; change: (dir: string) => void; barOnBranch?: unknown }) {
    const dir = mkdtempSync(path.join(tmpdir(), "cvh-scope-"));
    dirs.push(dir);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    const write = (file: string, content: string) => {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), content);
    };
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    git("config", "commit.gpgsign", "false");
    write("scripts/ci/search-guard-paths.txt", RULES);
    write("data/catalogue/providers.json", "[]\n");
    write("src/platform/config/env.ts", "const smsSegmentsPerSecond = 1;\nconst threshold = 0.3;\n");
    write("README.md", "hello\n");
    if (options.bar !== undefined) write("data/search-test-set/bar.json", JSON.stringify(options.bar));
    git("add", "-A");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    git("checkout", "-qb", "change");
    options.change(dir);
    if (options.barOnBranch !== undefined) write("data/search-test-set/bar.json", JSON.stringify(options.barOnBranch));
    git("add", "-A");
    git("commit", "-qm", "change", "--allow-empty");
    const head = git("rev-parse", "HEAD");
    const output = path.join(dir, ".output");
    const summary = path.join(dir, ".summary");
    writeFileSync(output, "");
    execFileSync("bash", [SCOPE, base, head], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, GITHUB_ACTIONS: "" } });
    const outputs = Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map((line) => line.split("=") as [string, string]));
    return { outputs, summary: readFileSync(summary, "utf8") };
  }
  const BAR = { version: 1, approvedBy: "Hub Director", approvedOn: "2026-10-20", minimums: { hitRate: { en: 0.8 }, noMatchAccuracy: 0.9, emergencyAccuracy: 1 } };
  const edit = (file: string, content: string) => (dir: string) => writeFileSync(path.join(dir, file), content);

  it("answers a pull request that changes nothing search depends on: nothing to measure", () => {
    const { outputs, summary } = repo({ bar: BAR, change: edit("README.md", "changed\n") });
    expect(outputs).toEqual({ changed: "false", bar: "set", measure: "false" });
    expect(summary).toContain("nothing to measure");
  });

  it("measures a catalogue change when the base branch has an approved bar", () => {
    const { outputs, summary } = repo({ bar: BAR, change: edit("data/catalogue/providers.json", '[{"id":"M001"}]\n') });
    expect(outputs).toEqual({ changed: "true", bar: "set", measure: "true" });
    expect(summary).toContain("`data/catalogue/providers.json`");
  });

  it("does not measure while there is no bar, or the bar is not approved, and says why", () => {
    expect(repo({ change: edit("data/catalogue/providers.json", "[1]\n") }).outputs).toEqual({ changed: "true", bar: "none", measure: "false" });
    const unapproved = repo({ bar: { version: 1, approvedBy: null, approvedOn: null, minimums: null }, change: edit("data/catalogue/providers.json", "[1]\n") });
    expect(unapproved.outputs.measure).toBe("false");
    expect(unapproved.summary).toContain("the launch bar has not been approved yet");
  });

  it("takes the bar from the base branch: a pull request that adds a bar is not measured by it", () => {
    expect(repo({ change: edit("data/catalogue/providers.json", "[1]\n"), barOnBranch: BAR }).outputs).toEqual({ changed: "true", bar: "none", measure: "false" });
  });

  it("counts a change to the settings file only when a changed line is a search setting", () => {
    expect(repo({ bar: BAR, change: edit("src/platform/config/env.ts", "const smsSegmentsPerSecond = 2;\nconst threshold = 0.3;\n") }).outputs.changed).toBe("false");
    expect(repo({ bar: BAR, change: edit("src/platform/config/env.ts", "const smsSegmentsPerSecond = 1;\nconst threshold = 0.35;\n") }).outputs.changed).toBe("true");
  });
});
