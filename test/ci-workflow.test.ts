// Structural checks of .github/workflows/ci.yml for S01.03: who migrates
// which database, and in what order relative to the deploy.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = readFileSync(path.join(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8");

/** The text of one job: from its "  <name>:" line to the next job. */
function job(name: string): string {
  const jobs = workflow.slice(workflow.indexOf("\njobs:\n"));
  const start = jobs.search(new RegExp(`^  ${name}:$`, "m"));
  if (start === -1) throw new Error(`no job ${name}`);
  const rest = jobs.slice(start + 1);
  const next = rest.search(/^ {2}[\w-]+:$/m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Steps of a job, each as its own text block. */
function steps(text: string): string[] {
  return text.split(/^ {6}- /m).slice(1);
}

const stepIndex = (all: string[], pattern: RegExp) => {
  const index = all.findIndex((step) => pattern.test(step));
  if (index === -1) throw new Error(`no step matching ${pattern}`);
  return index;
};

describe("CI workflow (S01.03)", () => {
  it("migrates production after the build and before the deploy, from the head of main only", () => {
    const production = steps(job("production"));
    const migrateStep = production[stepIndex(production, /npm run db:migrate/)];

    expect(stepIndex(production, /vercel build --prod/)).toBeLessThan(stepIndex(production, /npm run db:migrate/));
    expect(stepIndex(production, /npm run db:migrate/)).toBeLessThan(stepIndex(production, /name: Deploy$/m));
    expect(migrateStep).toMatch(/if: steps\.head\.outputs\.current == 'true'/);
    expect(migrateStep).toMatch(/--check-destructive/);
    expect(migrateStep).toMatch(/MIGRATE_DATABASE_URL: \$\{\{ secrets\.PRODUCTION_DATABASE_URL \}\}/);
    // Implicit success(): a failed migration skips the deploy, promote, smoke check and rollback.
    expect(migrateStep).not.toMatch(/always\(\)|failure\(\)|!cancelled\(\)|continue-on-error/);
    const deploy = production[stepIndex(production, /name: Deploy$/m)];
    expect(deploy).not.toMatch(/always\(\)|!cancelled\(\)/);
  });

  it("fails the production job before deploying when the database secret is missing", () => {
    const production = steps(job("production"));
    const settings = production[0];

    expect(settings).toMatch(/HAS_DATABASE: \$\{\{ secrets\.PRODUCTION_DATABASE_URL != '' \}\}/);
    expect(settings).toMatch(/\[ "\$HAS_DATABASE" = true \] \|\| missing\+=\("secret PRODUCTION_DATABASE_URL"\)/);
    expect(settings).toMatch(/::error title=Production not deployed::/);
  });

  it("never gives previews the production database or a migration step", () => {
    const preview = job("preview");

    expect(preview).not.toMatch(/PRODUCTION_DATABASE_URL|db:migrate|MIGRATE_DATABASE_URL/);
    expect(workflow.match(/secrets\.PRODUCTION_DATABASE_URL/g)).toHaveLength(2);
  });

  it("runs the database checks against a disposable service container in the Checks job", () => {
    const checks = job("checks");
    const all = steps(checks);

    expect(checks).toMatch(/image: supabase\/postgres:/);
    expect(checks).toMatch(/CI_DATABASE_URL: postgres:\/\/postgres:postgres@localhost:5432\/postgres/);
    expect(checks).not.toMatch(/secrets\./);
    for (const script of ["db:migrate", "db:check", "test:db", "db:check-destructive -- --base \"$base\""]) {
      expect(all.some((step) => step.includes(`npm run ${script}`)), script).toBe(true);
    }
    expect(stepIndex(all, /npm run db:migrate/)).toBeLessThan(stepIndex(all, /npm run db:check$/m));
  });

  it("compares with the first parent on main, where HEAD is origin/main and would be compared with itself", () => {
    const all = steps(job("checks"));
    const destructive = all[stepIndex(all, /npm run db:check-destructive/)];

    expect(destructive).toMatch(/base=origin\/main/);
    expect(destructive).toMatch(/if \[ "\$GITHUB_REF" = refs\/heads\/main \]; then base=HEAD~1; fi/);
    expect(destructive).not.toMatch(/--base origin\/main/);
  });

  it("gives the production secrets only to a job in the production environment, and the preview job the preview one", () => {
    const parsed = parse(workflow).jobs;

    expect(parsed.production.environment).toEqual({ name: "production", url: "${{ vars.PRODUCTION_URL }}" });
    expect(parsed.preview.environment).toBe("preview");
    expect(parsed.checks.environment).toBeUndefined();
    // Only these two jobs read secrets; the settings check works for repository or environment secrets alike.
    for (const name of Object.keys(parsed)) {
      if (name === "production" || name === "preview") continue;
      expect(JSON.stringify(parsed[name]), name).not.toMatch(/secrets\./);
    }
    expect(job("production")).toMatch(/HAS_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN != '' \}\}/);
    expect(job("preview")).toMatch(/HAS_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN != '' \}\}/);
  });

  it("runs the preview gate, which gets the Vercel token, from main's scripts rather than the branch's", () => {
    const preview = steps(job("preview"));
    const trusted = preview[stepIndex(preview, /ref: main\b/)];
    const gate = preview[stepIndex(preview, /preview-gate\.sh/)];

    expect(trusted).toMatch(/uses: actions\/checkout@/);
    expect(trusted).toMatch(/path: trusted/);
    expect(trusted).toMatch(/persist-credentials: false/);
    expect(stepIndex(preview, /ref: main\b/)).toBeLessThan(stepIndex(preview, /preview-gate\.sh/));
    expect(gate).toMatch(/run: trusted\/scripts\/ci\/preview-gate\.sh/);
    expect(gate).toMatch(/VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
  });

  it("checks destructive changes against what each migration removed from the CI database", () => {
    const all = steps(job("checks"));
    const migrateStep = all[stepIndex(all, /npm run db:migrate/)];
    const destructive = all[stepIndex(all, /npm run db:check-destructive/)];

    expect(migrateStep).toMatch(/npm run db:migrate -- --removals-report "\$RUNNER_TEMP\/migration-removals\.json"/);
    expect(destructive).toMatch(/--removals "\$RUNNER_TEMP\/migration-removals\.json"/);
    expect(stepIndex(all, /npm run db:migrate/)).toBeLessThan(stepIndex(all, /npm run db:check-destructive/));
  });
});
