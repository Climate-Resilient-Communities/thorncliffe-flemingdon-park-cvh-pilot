// .github/workflows/demo-data-production.yml loads the made-up demo data (the partner space's, and five place suggestions) into production,
// on purpose, from GitHub (the product owner's decision of 2026-11-07). These tests keep it as narrow as the seed workflow: manual, from main,
// in the production environment, a dry run by default, the production secret only, and only the two demo loaders, never a seed:* script.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = path.join(__dirname, "..");
const text = readFileSync(
  path.join(root, ".github", "workflows", "demo-data-production.yml"),
  "utf8",
);
const workflow = parse(text);
const pkg = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
) as { scripts: Record<string, string> };
const job = workflow.jobs.demo;
const steps: { run?: string; env?: Record<string, string> }[] = job.steps;
const runs = steps.map((step) => step.run ?? "").join("\n");

describe("demo-data-production workflow", () => {
  it("is manual, from main only, in the production environment", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(job.environment).toBe("production");
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
    expect(Object.keys(workflow.jobs)).toEqual(["demo"]);
  });

  it("defaults to a dry run, is read-only to the repository and never overlaps a seed run", () => {
    expect(workflow.on.workflow_dispatch.inputs.mode.default).toBe("dry-run");
    expect(workflow.on.workflow_dispatch.inputs.mode.options).toEqual([
      "dry-run",
      "apply",
    ]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toEqual({
      group: "seed-production",
      "cancel-in-progress": false,
    });
  });

  it("runs only the two demo loaders, which exist, and no seed:* script", () => {
    const commands = [...runs.matchAll(/npm run ([\w:]+)/g)].map(
      (match) => match[1],
    );
    expect([...new Set(commands)].sort()).toEqual([
      "demo:submissions",
      "dummy:partners",
    ]);
    for (const command of commands)
      expect(pkg.scripts[command], command).toBeDefined();
    expect(runs).not.toMatch(/npm run "?seed:/);
  });

  it("takes SEED_DATABASE_URL from secrets.PRODUCTION_DATABASE_URL and nowhere else", () => {
    const withUrl = steps.filter(
      (step) => step.env && "SEED_DATABASE_URL" in step.env,
    );
    expect(withUrl).toHaveLength(1);
    expect(withUrl[0].env!.SEED_DATABASE_URL).toBe(
      "${{ secrets.PRODUCTION_DATABASE_URL }}",
    );
    expect(text.match(/secrets\./g)).toHaveLength(1);
  });
});
