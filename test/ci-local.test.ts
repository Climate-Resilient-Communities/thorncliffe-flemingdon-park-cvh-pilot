// scripts/ci/local.sh must run what the three checks jobs of .github/workflows/checks.yml (Static, Database, Browser) run,
// in that order: the same npm/npx commands, with the same arguments, in the same order.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = path.join(__dirname, "..");
const workflowText = readFileSync(path.join(root, ".github", "workflows", "checks.yml"), "utf8");
const scriptText = readFileSync(path.join(root, "scripts", "ci", "local.sh"), "utf8");

interface Entry {
  command: string;
  /** Runs even when an earlier step failed (`if: ${{ !cancelled() }}`). */
  always: boolean;
  /** Names of the environment variables the step sets. */
  env: string[];
}

interface WorkflowStep {
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
}

/** The checks jobs, in the order local.sh runs them. */
const JOBS = ["static", "database", "browser"];

/**
 * The npm/npx commands of the three checks jobs, one entry per command line. Each job installs on its own runner
 * (`npm ci`); local.sh installs once, so only the first install is an entry.
 */
function workflowEntries(text: string): Entry[] {
  const jobs = parse(text).jobs;
  const steps: WorkflowStep[] = JOBS.flatMap((name) => jobs[name].steps as WorkflowStep[]);
  const entries: Entry[] = [];
  for (const step of steps) {
    if (!step.run) continue;
    const always = step.if?.replace(/\s/g, "") === "${{!cancelled()}}";
    if (step.if && !always) throw new Error(`step "${step.name ?? step.run}" has an if that local.sh cannot mirror: ${step.if}`);
    for (const line of step.run.split("\n").map((l) => l.trim())) {
      if (!/^(npm|npx)\b/.test(line)) continue;
      if (line === "npm ci" && entries.some((entry) => entry.command === "npm ci")) continue;
      entries.push({ command: line, always, env: Object.keys(step.env ?? {}).sort() });
    }
  }
  return entries;
}

/**
 * The steps of local.sh: lines like `[VAR=value ...] step <command>`,
 * `always_step <command>` and `replaced_step '<ci command>' <what runs instead>`.
 */
function scriptEntries(text: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of text.split("\n")) {
    const match = /^((?:[A-Z_]+=(?:"[^"]*"|\S*) )*)(step|always_step|replaced_step) (.+)$/.exec(line);
    if (!match) continue;
    const env = [...match[1].matchAll(/([A-Z_]+)=/g)].map((m) => m[1]).sort();
    const [, , kind, rest] = match;
    const command = kind === "replaced_step" ? (/^'([^']+)'/.exec(rest)?.[1] ?? rest) : rest;
    entries.push({ command, always: kind === "always_step", env });
  }
  return entries;
}

const describeEntry = (entry: Entry) => `\`${entry.command}\``;

/** The same npm script or npx binary, whatever the arguments. */
const sameScript = (a: string, b: string) => a.split(" -- ")[0] === b.split(" -- ")[0];

/** Everything that differs between the Checks job and the local script, one message each. */
function compare(workflow: string, script: string): string[] {
  const ci = workflowEntries(workflow);
  const local = scriptEntries(script);
  const problems: string[] = [];
  const remaining = [...local];

  for (const entry of ci) {
    const index = remaining.findIndex((candidate) => candidate.command === entry.command);
    if (index === -1) {
      const nearIndex = remaining.findIndex((candidate) => sameScript(candidate.command, entry.command));
      const near = nearIndex === -1 ? undefined : remaining.splice(nearIndex, 1)[0];
      problems.push(
        near
          ? `step ${describeEntry(entry)} of CI differs in local.sh: ${describeEntry(near)}`
          : `step ${describeEntry(entry)} of CI is missing from scripts/ci/local.sh`,
      );
      continue;
    }
    const [match] = remaining.splice(index, 1);
    if (match.always !== entry.always) {
      problems.push(`step ${describeEntry(entry)}: CI ${entry.always ? "runs it even after a failure" : "skips it after a failure"}; local.sh does the opposite`);
    }
    if (match.env.join() !== entry.env.join()) {
      problems.push(`step ${describeEntry(entry)}: CI sets env [${entry.env}]; local.sh sets [${match.env}]`);
    }
  }
  for (const extra of remaining) {
    problems.push(`step ${describeEntry(extra)} of scripts/ci/local.sh is not in the CI checks jobs`);
  }
  if (problems.length === 0) {
    const order = (entries: Entry[]) => entries.map((e) => e.command);
    const a = order(ci);
    const b = order(local);
    const at = a.findIndex((command, i) => command !== b[i]);
    if (at !== -1) problems.push(`step ${describeEntry(ci[at])} is at position ${at + 1} in CI but ${b.indexOf(a[at]) + 1} in local.sh (order differs)`);
  }
  return problems;
}

/** The workflow with one extra step added to the Checks job after the step running `after`. */
function withExtraStep(text: string, after: string, extra: string): string {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.trim() === `- run: ${after}`);
  if (index === -1) throw new Error(`no step "${after}" in the fixture`);
  lines.splice(index + 1, 0, `      - run: ${extra}`);
  return lines.join("\n");
}

describe("scripts/ci/local.sh mirrors the checks jobs", () => {
  it("has every npm/npx step of the Static, Database and Browser jobs, in the same order, with the same arguments", () => {
    expect(compare(workflowText, scriptText)).toEqual([]);
  });

  it("reads the steps it compares", () => {
    const commands = workflowEntries(workflowText).map((entry) => entry.command);

    expect(commands[0]).toBe("npm ci");
    expect(commands).toContain("npm run check:strings");
    expect(commands.at(-1)).toBe("npm run test:smoke");
    expect(workflowEntries(workflowText).find((e) => e.command === "npm run check:strings")?.always).toBe(true);
  });

  it("reports a step added to CI but not to local.sh", () => {
    const fixture = withExtraStep(workflowText, "npm run lint", "npm run fake:check -- --flag");

    expect(compare(fixture, scriptText)).toEqual(["step `npm run fake:check -- --flag` of CI is missing from scripts/ci/local.sh"]);
  });

  it("reports a step added to local.sh but not to CI", () => {
    const script = scriptText.replace("step npm run lint\n", "step npm run lint\nstep npm run fake:check\n");

    expect(compare(workflowText, script)).toEqual(["step `npm run fake:check` of scripts/ci/local.sh is not in the CI checks jobs"]);
  });

  it("reports changed arguments", () => {
    const script = scriptText.replace('--base "$base"', "--base origin/develop");

    const problems = compare(workflowText, script);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/db:check-destructive -- --base "\$base"/);
    expect(problems[0]).toMatch(/differs in local\.sh/);
  });

  it("compares with the first parent of origin/main when HEAD is origin/main, and otherwise with origin/main", () => {
    expect(scriptText).toMatch(/base=origin\/main\nif \[ "\$\(git rev-parse HEAD\)" = "\$\(git rev-parse origin\/main\)" \]; then base=HEAD~1; fi/);
  });

  it("reports a different order", () => {
    const script = scriptText.replace("step npm run lint\nstep npm run typecheck\n", "step npm run typecheck\nstep npm run lint\n");

    expect(compare(workflowText, script).join("\n")).toMatch(/npm run lint` is at position 2 in CI but 3 in local\.sh/);
  });

  it("reports a step that no longer runs after a failure", () => {
    const script = scriptText.replace("always_step npm run check:strings", "step npm run check:strings");

    expect(compare(workflowText, script)).toEqual(["step `npm run check:strings`: CI runs it even after a failure; local.sh does the opposite"]);
  });

  it("reports a changed step environment", () => {
    const script = scriptText.replace('APP_VERSION="$GITHUB_SHA" step npm run build', "step npm run build");

    expect(compare(workflowText, script)).toEqual(["step `npm run build`: CI sets env [APP_VERSION]; local.sh sets []"]);
  });
});
