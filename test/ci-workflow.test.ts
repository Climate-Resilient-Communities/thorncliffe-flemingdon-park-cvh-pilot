// Structural checks of .github/workflows/ci.yml for S01.03: who migrates
// which database, and in what order relative to the deploy.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
    for (const script of ["db:migrate", "db:check", "test:db", "db:check-destructive -- --base origin/main"]) {
      expect(all.some((step) => step.includes(`npm run ${script}`)), script).toBe(true);
    }
    expect(stepIndex(all, /npm run db:migrate/)).toBeLessThan(stepIndex(all, /npm run db:check$/m));
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
