// Structural checks of .github/workflows/ci.yml for S01.03: who migrates
// which database, and in what order relative to the deploy.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    // The comments may name the secret to explain why it is not here.
    const preview = job("preview").replace(/^\s*#.*$/gm, "");

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

  it("compares with the commit before the push on main, where HEAD is origin/main and would be compared with itself", () => {
    const all = steps(job("checks"));
    const destructive = all[stepIndex(all, /npm run db:check-destructive/)];

    expect(destructive).toMatch(/base=origin\/main/);
    expect(destructive).toMatch(/if \[ "\$GITHUB_REF" = refs\/heads\/main \]; then/);
    expect(destructive).toMatch(/before=\$\{\{ github\.event\.before \}\}/);
    expect(destructive).toMatch(/base=HEAD~1/);
    expect(destructive).not.toMatch(/--base origin\/main/);
  });

  describe("the base the destructive check compares with", () => {
    const ZEROS = "0".repeat(40);
    let dir: string;
    const vcs = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=x", ...args], { cwd: dir, encoding: "utf8" }).trim();

    /** The step's script, with the check itself replaced by an echo of the base it would get. */
    function baseFor(ref: string, before: string): string {
      const step = parse(workflow).jobs.checks.steps.find((s: { run?: string }) => s.run?.includes("db:check-destructive"));
      const script = (step.run as string)
        .replace("${{ github.event.before }}", before)
        .replace(/npm run db:check-destructive.*/, 'echo "$base"');
      return execFileSync("bash", ["-e", "-c", script], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, GITHUB_REF: ref, RUNNER_TEMP: dir },
      }).trim();
    }

    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), "ci-base-"));
      vcs("init", "-q", "-b", "main");
      for (const n of ["one", "two", "three", "four"]) vcs("commit", "-q", "--allow-empty", "-m", n);
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("is origin/main on a branch", () => {
      expect(baseFor("refs/heads/feature", vcs("rev-parse", "HEAD~2"))).toBe("origin/main");
    });

    it("is the commit before the push on main, so every commit of a multi-commit push is checked", () => {
      expect(baseFor("refs/heads/main", vcs("rev-parse", "HEAD~2"))).toBe(vcs("rev-parse", "HEAD~2"));
    });

    it("is HEAD~1 on main when the push has no previous commit (a new branch)", () => {
      expect(baseFor("refs/heads/main", ZEROS)).toBe("HEAD~1");
    });

    it("is HEAD~1 on main when the previous commit is not in the history (a forced push)", () => {
      expect(baseFor("refs/heads/main", "a".repeat(40))).toBe("HEAD~1");
    });

    it("is HEAD~1 on main when the previous commit is not an ancestor of HEAD", () => {
      vcs("checkout", "-q", "-b", "other", "HEAD~2");
      vcs("commit", "-q", "--allow-empty", "-m", "diverged");
      const diverged = vcs("rev-parse", "HEAD");
      vcs("checkout", "-q", "main");

      expect(baseFor("refs/heads/main", diverged)).toBe("HEAD~1");
    });
  });

  it("explains what previews share and what the preview environment protects", () => {
    const preview = job("preview");

    expect(preview).toMatch(/Previews share the single Supabase project/);
    expect(preview).toMatch(/vercel pull --environment=preview/);
    expect(preview).toMatch(/DATABASE_URL and SUPABASE_SECRET_KEY/);
    expect(preview).toMatch(/keeps PRODUCTION_DATABASE_URL/);
    expect(preview).toMatch(/team-scoped/);
    expect(preview).not.toMatch(/must never hold production secrets/);
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

  it("keeps main's trusted checkout out of the preview build's type check", () => {
    // A sparse checkout still brings main's root files, next.config.ts among them; the build must not compile them.
    const tsconfig = JSON.parse(readFileSync(path.join(__dirname, "..", "tsconfig.json"), "utf8"));
    expect(tsconfig.exclude).toContain("trusted");
  });

  it("checks destructive changes against what each migration removed from the CI database", () => {
    const all = steps(job("checks"));
    const migrateStep = all[stepIndex(all, /npm run db:migrate/)];
    const destructive = all[stepIndex(all, /npm run db:check-destructive/)];

    expect(migrateStep).toMatch(/npm run db:migrate -- --removals-report "\$RUNNER_TEMP\/migration-removals\.json"/);
    expect(destructive).toMatch(/--removals "\$RUNNER_TEMP\/migration-removals\.json"/);
    expect(stepIndex(all, /npm run db:migrate/)).toBeLessThan(stepIndex(all, /npm run db:check-destructive/));
  });

  it("uploads each deployment as one tarball, because the Hobby plan caps daily file uploads", () => {
    const deploys = workflow.match(/vercel deploy .*/g) ?? [];

    expect(deploys).toHaveLength(2);
    for (const command of deploys) expect(command).toMatch(/^vercel deploy --prebuilt --archive=tgz /);
    expect(job("production")).toMatch(/vercel deploy --prebuilt --archive=tgz --prod --skip-domain --json/);
  });

  it("deploys previews only for branches with an open pull request, with read-only token scopes", () => {
    const preview = job("preview");
    const all = steps(preview);

    expect(preview).toMatch(/permissions:\n {6}contents: read\n {6}pull-requests: read\n/);
    expect(job("production")).not.toMatch(/pull-requests/);
    expect(all[stepIndex(all, /open-pr-gate\.sh/)]).toMatch(/GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
    expect(all[stepIndex(all, /open-pr-gate\.sh/)]).toMatch(/run: trusted\/scripts\/ci\/open-pr-gate\.sh/);
    expect(stepIndex(all, /ref: main\b/)).toBeLessThan(stepIndex(all, /open-pr-gate\.sh/));
    expect(stepIndex(all, /open-pr-gate\.sh/)).toBeLessThan(stepIndex(all, /preview-gate\.sh/));
    expect(all[stepIndex(all, /preview-gate\.sh/)]).toMatch(/if: steps\.pr\.outputs\.open == 'true'/);
    expect(preview).not.toMatch(/continue-on-error/);
  });
});
