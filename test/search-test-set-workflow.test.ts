// .github/workflows/search-test-set.yml lets the owner run the tuning questions against production's search use case from
// GitHub (S03.07), where the Cohere key, the Supabase secret key and the production database live. These tests keep it manual,
// on main only, in the production environment, read-only to the repository, tuning-only (the evaluation subset is S03.08's),
// free of injection (inputs reach the shell only as environment variables), with the secrets in the two steps that need them,
// and writing only aggregates to the job summary. The command it runs is checked against the command line's own parser.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { resolveAllowance } from "../scripts/search-test-set/allowance";
import { parseProductionOptions, REQUIRED_VARIABLES } from "../scripts/search-test-set/production";
import { parseSearchEnv } from "@/platform/config/env";

const root = path.join(__dirname, "..");
const text = readFileSync(path.join(root, ".github", "workflows", "search-test-set.yml"), "utf8");
const workflow = parse(text);
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  "timeout-minutes"?: number;
  env?: Record<string, string>;
  with?: Record<string, string>;
}
const job = workflow.jobs.run;
const steps: Step[] = job.steps;
const step = (name: RegExp) => {
  const found = steps.filter((s) => name.test(s.name ?? ""));
  expect(found, String(name)).toHaveLength(1);
  return found[0]!;
};

describe("search-test-set workflow", () => {
  it("is triggered by workflow_dispatch only, and runs in the production environment, from main only", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(job.environment).toBe("production");
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
    expect(Object.keys(workflow.jobs)).toEqual(["run"]);
    expect(step(/Check the inputs/).run).toContain('"$GITHUB_REF" != refs/heads/main');
  });

  it("checks out the exact commit it was started on, which must still be the head of main, and does not keep the token in the checkout (the steps that hold the secrets have no use for it)", () => {
    expect(steps.find((s) => s.uses?.startsWith("actions/checkout"))!.with).toEqual({ ref: "${{ github.sha }}", "persist-credentials": false });
    expect(step(/still the head of main/).run).toContain("git ls-remote origin refs/heads/main");
    // The head of main is read without a token: nothing in the job hands one to a step.
    expect(text).not.toMatch(/GITHUB_TOKEN|github\.token/);
  });

  it("has least privilege: read-only permissions, none added to the job, and a non-cancelling concurrency group", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job.permissions).toBeUndefined();
    expect(workflow.concurrency.group).toBe("search-test-set");
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
  });

  it("limits the run step below the job, so that a run that takes too long fails that step and the steps that keep the reports still run (a cancelled job skips them)", () => {
    const run = step(/Run the search test set/);
    expect(run["timeout-minutes"]).toBeGreaterThan(0);
    expect(run["timeout-minutes"]!).toBeLessThan(job["timeout-minutes"] - 5);
    for (const name of [/Upload the reports/, /Write the summary/]) expect(step(name).if).toBe("${{ !cancelled() }}");
    // A step that fails is not a cancelled job: nothing after the run step is conditional on its success.
    expect(text).not.toMatch(/continue-on-error|if:\s*success\(\)|if:\s*always\(\)/);
  });

  it("only prints the plan unless confirm is ticked: the input is a boolean that defaults to false, and --yes is passed only for confirm", () => {
    const confirm = workflow.on.workflow_dispatch.inputs.confirm;
    expect(confirm.type).toBe("boolean");
    expect(confirm.default).toBe(false);
    expect(confirm.required).toBe(false);
    const run = step(/Run the search test set/).run!;
    expect(run).toContain('if [ "$CONFIRM" = true ]; then args+=(--yes); else args+=(--plan-only); fi');
    expect(run.match(/--yes/g)).toHaveLength(1);
    expect(step(/Check the inputs/).run).toContain('case "$CONFIRM" in true | false) ;;');
    // Both forms are ones the command line accepts, and the plan-only one is not a run.
    const base = ["run", "--engine", "production", "--model", "embed-v4.0", "--translated-leg", "both", "--split", "tuning", "--scores", "--out-dir", "/tmp/x", "--summary-file", "/tmp/x/summary.md"];
    expect(parseProductionOptions([...base, "--plan-only"])).toMatchObject({ ok: true, options: { planOnly: true, yes: false } });
    expect(parseProductionOptions([...base, "--yes"])).toMatchObject({ ok: true, options: { planOnly: false, yes: true } });
  });

  it("offers the tuning subset only, and refuses any other in its own check (the evaluation subset is S03.08's)", () => {
    const split = workflow.on.workflow_dispatch.inputs.split;
    expect(split.type).toBe("choice");
    expect(split.options).toEqual(["tuning"]);
    expect(step(/Check the inputs/).run).toContain('[ "$SPLIT" = tuning ]');
    expect(step(/Check the inputs/).run).toContain("S03.08");
    expect(text).not.toMatch(/--final|s03-08-evaluation|--split\s+"?(evaluation|all)/);
    expect(text).not.toMatch(/options:[\s\S]{0,80}evaluation/);
  });

  it("offers the legs off, on and both, and an optional cap on the calls", () => {
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(inputs.leg.options).toEqual(["off", "on", "both"]);
    expect(inputs.max_calls.type).toBe("string");
    expect(inputs.max_calls.required).toBe(false);
    expect(step(/Check the inputs/).run).toContain("MAX_CALLS");
    expect(step(/Check the inputs/).run).toMatch(/\^\[1-9\]\[0-9\]\{0,5\}\$/);
  });

  it("never interpolates an expression into a script: inputs, secrets and variables reach the shell as environment variables only", () => {
    for (const s of steps) {
      if (s.run !== undefined) expect(s.run, s.name ?? s.run).not.toContain("${{");
    }
    expect(job.env).toEqual({ SPLIT: "${{ inputs.split }}", LEG: "${{ inputs.leg }}", CONFIRM: "${{ inputs.confirm }}", MAX_CALLS: "${{ inputs.max_calls }}" });
    const expressions = [...text.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]!);
    const secret = "secrets\\.[A-Z_]+( != '')?";
    for (const expression of expressions) {
      expect(expression, expression).toMatch(new RegExp(`^(inputs\\.(split|leg|confirm|max_calls)|${secret}|vars\\.[A-Z_]+( != '')?|github\\.(sha|run_id)|runner\\.temp|!cancelled\\(\\))$`));
    }
  });

  it("has the secret values in the run step only: the check step is told whether each is set, as true or false, and nothing else is", () => {
    const withValues = steps.filter((s) => Object.values(s.env ?? {}).some((value) => value.includes("secrets.") && !value.includes("!= ''")));
    expect(withValues.map((s) => s.name)).toEqual(["Run the search test set"]);
    expect(JSON.stringify(job.env)).not.toContain("secrets.");
    const check = step(/has what the run needs/);
    for (const value of Object.values(check.env!)) expect(value).toMatch(/!= ''/);
    expect(
      [...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).filter((name, index, all) => all.indexOf(name) === index).sort(),
    ).toEqual(["COHERE_API_KEY", "SEARCH_TEST_DATABASE_URL", "SUPABASE_SECRET_KEY"]);
    const install = steps.findIndex((s) => s.run === "npm ci");
    expect(install).toBeGreaterThan(-1);
    expect(steps[install]!.env).toBeUndefined();
  });

  it("names a missing secret or variable without printing any value, and stops before anything is installed or called", () => {
    const check = step(/has what the run needs/);
    for (const name of ["SEARCH_TEST_DATABASE_URL", "COHERE_API_KEY", "SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL"]) expect(check.run).toContain(name);
    expect(check.run).toContain('"${!have}" != true');
    expect(check.run).toContain("exit $missing");
    expect(steps.indexOf(check)).toBeLessThan(steps.findIndex((s) => s.run === "npm ci"));
    expect(text).not.toMatch(/echo[^\n]*\$\{?(COHERE_API_KEY|SUPABASE_SECRET_KEY|SEARCH_TEST_DATABASE_URL|PRODUCTION_DATABASE_URL)\b/);
    expect(text).not.toMatch(/printenv|^\s*env\s*$|set -x|--verbose/m);
  });

  it("gives the command line what it requires, under the names it reads", () => {
    const run = step(/Run the search test set/);
    // The app's own login, which can do all the run does: never the superuser's production URL, which the seeds use.
    expect(run.env!.SEARCH_TEST_DATABASE_URL).toBe("${{ secrets.SEARCH_TEST_DATABASE_URL }}");
    expect(text).not.toContain("PRODUCTION_DATABASE_URL");
    expect(run.env!.COHERE_API_KEY).toBe("${{ secrets.COHERE_API_KEY }}");
    expect(run.env!.SUPABASE_SECRET_KEY).toBe("${{ secrets.SUPABASE_SECRET_KEY }}");
    expect(run.env!.NEXT_PUBLIC_SUPABASE_URL).toBe("${{ vars.NEXT_PUBLIC_SUPABASE_URL }}");
    for (const name of REQUIRED_VARIABLES) expect(Object.keys(run.env!), name).toContain(name);
  });

  it("forwards production's own SEARCH_* values under their own names, and the app's parser takes them (blank is unset)", () => {
    const run = step(/Run the search test set/);
    const forwarded = Object.keys(run.env!).filter((name) => name.startsWith("SEARCH_") && !name.startsWith("SEARCH_TEST_"));
    expect(forwarded.sort()).toEqual(["SEARCH_EMERGENCY_THRESHOLD", "SEARCH_FALLBACK_MIN_BUDGET_MS", "SEARCH_QUESTION_FALLBACK", "SEARCH_QUESTION_ROUTE", "SEARCH_THRESHOLD"]);
    for (const name of forwarded) expect(run.env![name]).toBe(`\${{ vars.${name} }}`);
    expect(() => parseSearchEnv(Object.fromEntries(forwarded.map((name) => [name, ""])))).not.toThrow();
  });

  it("forwards the allowance's two variables (the key's calls a month and the calls kept for live search) as variables, and the command line takes them blank", () => {
    const run = step(/Run the search test set/);
    for (const name of ["SEARCH_TEST_MONTHLY_CALLS", "SEARCH_TEST_RESERVE_CALLS"]) expect(run.env![name]).toBe(`\${{ vars.${name} }}`);
    expect(resolveAllowance({ SEARCH_TEST_MONTHLY_CALLS: "", SEARCH_TEST_RESERVE_CALLS: "" })).toMatchObject({ ok: true, allowance: { monthly: 1000, reserve: 200 } });
  });

  it("runs the package script with arguments the command line accepts: the production engine, the model, the leg and the tuning split from the environment, --yes, and the files in the temp folder", () => {
    expect(pkg.scripts["search-test-set"]).toBeDefined();
    const run = step(/Run the search test set/).run!;
    expect(run).toContain('npm run search-test-set -- "${args[@]}"');
    expect(run).toContain('args=(run --engine production --model embed-v4.0 --translated-leg "$LEG" --split "$SPLIT"');
    const parsed = parseProductionOptions(["run", "--engine", "production", "--model", "embed-v4.0", "--translated-leg", "both", "--split", "tuning", "--scores", "--yes", "--out-dir", "/tmp/x", "--summary-file", "/tmp/x/summary.md", "--max-calls", "300"]);
    expect(parsed).toMatchObject({ ok: true, options: { legs: ["off", "on"], maxCalls: 300, yes: true, scores: true } });
    expect(run).toContain("--max-calls");
    expect(run).toContain("--yes");
    expect(text).not.toContain("--threshold");
  });

  it("uploads the per-question report, never the printed output (an artifact is not masked, and this repository is public), and writes only the aggregates to the job summary", () => {
    const upload = steps.find((s) => s.uses?.startsWith("actions/upload-artifact"))!;
    expect(upload.if).toBe("${{ !cancelled() }}");
    expect(upload.with!.path).toBe("${{ runner.temp }}/search-test-set");
    // What the command prints stays in the job log: it is not piped to a file anywhere, least of all one in the uploaded folder.
    const run = step(/Run the search test set/).run!;
    expect(run).not.toMatch(/\btee\b|>\s*"?\$out|log\.txt/);
    expect(text).not.toContain("log.txt");
    expect(run).toContain('npm run search-test-set -- "${args[@]}"');
    expect(run.trimEnd().endsWith('npm run search-test-set -- "${args[@]}"')).toBe(true);
    const summary = step(/Write the summary/).run!;
    expect(summary).toContain('>> "$GITHUB_STEP_SUMMARY"');
    expect(summary).toContain("summary.md");
    expect(summary).not.toContain("log.txt");
    expect(summary).not.toMatch(/\.json/);
    // The summary file is the one the command writes: aggregates only (checked in test/search-test-set-tuning.test.ts).
    expect(step(/Run the search test set/).run).toContain('--summary-file "$out/summary.md"');
  });

  it("pins actions to the versions ci.yml uses", () => {
    const ci = readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    const used = (t: string) => new Set([...t.matchAll(/uses: (actions\/[a-z-]+@v\d+)/g)].map((m) => m[1]));
    const ciActions = used(ci);
    expect(used(text).size).toBeGreaterThan(0);
    for (const action of used(text)) expect(ciActions.has(action), action).toBe(true);
  });
});
