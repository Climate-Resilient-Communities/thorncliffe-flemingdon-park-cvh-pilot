// .github/workflows/seed-production.yml lets the owner run a seed against production from GitHub.
// These tests keep it manual, read-only to the repository, in the production environment, defaulting
// to a dry run, and using only seeds that exist in package.json and only the production secret.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = path.join(__dirname, "..");
const text = readFileSync(
  path.join(root, ".github", "workflows", "seed-production.yml"),
  "utf8",
);
const workflow = parse(text);
const pkg = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

interface Step {
  run?: string;
  env?: Record<string, string>;
}
const job = workflow.jobs.seed;
const steps: Step[] = job.steps;
const packageSeeds = Object.keys(pkg.scripts)
  .filter((n) => n.startsWith("seed:"))
  .map((n) => n.slice("seed:".length));

describe("seed-production workflow", () => {
  it("is triggered by workflow_dispatch only", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  });

  it("runs in the production environment, from main only", () => {
    expect(job.environment).toBe("production");
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
    expect(Object.keys(workflow.jobs)).toEqual(["seed"]);
  });

  it("defaults to a dry run and offers dry-run, apply and launch-check", () => {
    const mode = workflow.on.workflow_dispatch.inputs.mode;
    expect(mode.default).toBe("dry-run");
    expect(mode.options).toEqual(["dry-run", "apply", "launch-check"]);
  });

  it("has read-only permissions and a non-cancelling concurrency group", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job.permissions).toBeUndefined();
    expect(workflow.concurrency.group).toBe("seed-production");
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  });

  it("offers exactly the seeds in package.json", () => {
    expect(packageSeeds.length).toBeGreaterThan(0);
    expect(
      [...workflow.on.workflow_dispatch.inputs.seed.options].sort(),
    ).toEqual([...packageSeeds].sort());
  });

  it("runs only allowlisted seeds, through npm run seed:$SEED", () => {
    const runs = steps.map((s) => s.run ?? "").join("\n");
    const allowlist = /case "\$SEED" in ([a-z |]+)\) ;;/.exec(runs);
    expect(allowlist).not.toBeNull();
    expect(
      allowlist![1]
        .split("|")
        .map((s) => s.trim())
        .sort(),
    ).toEqual([...packageSeeds].sort());
    const seedCommands = runs
      .split("\n")
      .filter((l) => /npm run "?seed/.test(l));
    expect(seedCommands).toHaveLength(1);
    expect(seedCommands[0]).toContain('npm run "seed:$SEED"');
  });

  it("takes SEED_DATABASE_URL from secrets.PRODUCTION_DATABASE_URL and nowhere else", () => {
    const withUrl = steps.filter((s) => s.env && "SEED_DATABASE_URL" in s.env);
    expect(withUrl).toHaveLength(1);
    expect(withUrl[0].env!.SEED_DATABASE_URL).toBe(
      "${{ secrets.PRODUCTION_DATABASE_URL }}",
    );
    expect(job.env?.SEED_DATABASE_URL).toBeUndefined();
    expect(
      [...text.matchAll(/\$\{\{\s*secrets\.([A-Z_]+)/g)].map((m) => m[1]),
    ).toEqual(["PRODUCTION_DATABASE_URL"]);
  });

  it("passes --dry-run or --yes by mode, and never prints the URL", () => {
    expect(text).toContain("dry-run) args+=(--dry-run)");
    expect(text).toContain("apply) args+=(--yes)");
    expect(text).not.toMatch(/echo[^\n]*SEED_DATABASE_URL/);
    expect(text).not.toMatch(/printenv|^\s*env\s*$/m);
  });

  it("pins actions to the commits ci.yml and checks.yml use", () => {
    const ci = ["ci.yml", "checks.yml"]
      .map((file) => readFileSync(path.join(root, ".github", "workflows", file), "utf8"))
      .join("\n");
    const used = (t: string) =>
      new Set(
        [...t.matchAll(/uses: (actions\/[a-z-]+@[0-9a-f]{40})/g)].map((m) => m[1]),
      );
    const ciActions = used(ci);
    expect(used(text).size).toBeGreaterThan(0);
    for (const action of used(text)) expect(ciActions.has(action)).toBe(true);
  });

  it("writes the report to the job summary", () => {
    expect(text).toContain('>> "$GITHUB_STEP_SUMMARY"');
  });
});
