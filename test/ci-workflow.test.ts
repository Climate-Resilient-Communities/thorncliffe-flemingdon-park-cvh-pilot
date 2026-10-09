// Structural checks of the CI workflows (ci.yml, checks.yml, preview.yml and the rest) for S01.03 and the pipeline changes:
// who migrates which database and in what order relative to the deploy, what the checks jobs are, and who may build a preview.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflowDir = path.join(__dirname, "..", ".github", "workflows");
const workflow = readFileSync(path.join(workflowDir, "ci.yml"), "utf8");
const checksWorkflow = readFileSync(
  path.join(workflowDir, "checks.yml"),
  "utf8",
);
const previewWorkflow = readFileSync(
  path.join(workflowDir, "preview.yml"),
  "utf8",
);

/** The text of one job of a workflow (ci.yml by default): from its "  <name>:" line to the next job. */
function job(name: string, text: string = workflow): string {
  const jobs = text.slice(text.indexOf("\njobs:\n"));
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

    expect(stepIndex(production, /vercel build --prod/)).toBeLessThan(
      stepIndex(production, /npm run db:migrate/),
    );
    expect(stepIndex(production, /npm run db:migrate/)).toBeLessThan(
      stepIndex(production, /name: Deploy$/m),
    );
    expect(migrateStep).toMatch(/if: steps\.head\.outputs\.current == 'true'/);
    expect(migrateStep).toMatch(/--check-destructive/);
    expect(migrateStep).toMatch(
      /MIGRATE_DATABASE_URL: \$\{\{ secrets\.PRODUCTION_DATABASE_URL \}\}/,
    );
    // Implicit success(): a failed migration skips the deploy, promote, smoke check and rollback.
    expect(migrateStep).not.toMatch(
      /always\(\)|failure\(\)|!cancelled\(\)|continue-on-error/,
    );
    const deploy = production[stepIndex(production, /name: Deploy$/m)];
    expect(deploy).not.toMatch(/always\(\)|!cancelled\(\)/);
  });

  it("fails the production job before deploying when the database secret is missing", () => {
    const production = steps(job("production"));
    const settings = production[0];

    expect(settings).toMatch(
      /HAS_DATABASE: \$\{\{ secrets\.PRODUCTION_DATABASE_URL != '' \}\}/,
    );
    expect(settings).toMatch(
      /\[ "\$HAS_DATABASE" = true \] \|\| missing\+=\("secret PRODUCTION_DATABASE_URL"\)/,
    );
    expect(settings).toMatch(/::error title=Production not deployed::/);
  });

  it("never gives previews the production database or a migration step", () => {
    // The comments may name the secret to explain why it is not here.
    const preview = previewWorkflow.replace(/^\s*#.*$/gm, "");

    expect(preview).not.toMatch(
      /PRODUCTION_DATABASE_URL|db:migrate|MIGRATE_DATABASE_URL/,
    );
    expect(workflow.match(/secrets\.PRODUCTION_DATABASE_URL/g)).toHaveLength(2);
    expect(checksWorkflow).not.toMatch(/secrets\./);
  });

  it("runs the database checks against a disposable service container in the Database job", () => {
    const checks = job("database", checksWorkflow);
    const all = steps(checks);

    expect(checks).toMatch(/image: supabase\/postgres:/);
    expect(checks).toMatch(
      /CI_DATABASE_URL: postgres:\/\/postgres:postgres@localhost:5432\/postgres/,
    );
    expect(checks).not.toMatch(/secrets\./);
    for (const script of [
      "db:migrate",
      "db:check",
      "test:db",
      'db:check-destructive -- --base "$base"',
    ]) {
      expect(
        all.some((step) => step.includes(`npm run ${script}`)),
        script,
      ).toBe(true);
    }
    expect(stepIndex(all, /npm run db:migrate/)).toBeLessThan(
      stepIndex(all, /npm run db:check$/m),
    );
  });

  it("compares with the commit before the push on main, where HEAD is origin/main and would be compared with itself", () => {
    const all = steps(job("database", checksWorkflow));
    const destructive = all[stepIndex(all, /npm run db:check-destructive/)];

    expect(destructive).toMatch(/base=origin\/main/);
    expect(destructive).toMatch(
      /if \[ "\$GITHUB_REF" = refs\/heads\/main \]; then/,
    );
    expect(destructive).toMatch(/before=\$\{\{ github\.event\.before \}\}/);
    expect(destructive).toMatch(/base=HEAD~1/);
    expect(destructive).not.toMatch(/--base origin\/main/);
  });

  describe("the base the destructive check compares with", () => {
    const ZEROS = "0".repeat(40);
    let dir: string;
    const vcs = (...args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.email=a@b", "-c", "user.name=x", ...args],
        { cwd: dir, encoding: "utf8" },
      ).trim();

    /** The step's script, with the check itself replaced by an echo of the base it would get. */
    function baseFor(ref: string, before: string): string {
      const step = parse(checksWorkflow).jobs.database.steps.find(
        (s: { run?: string }) => s.run?.includes("db:check-destructive"),
      );
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
      for (const n of ["one", "two", "three", "four"])
        vcs("commit", "-q", "--allow-empty", "-m", n);
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("is origin/main on a branch", () => {
      expect(baseFor("refs/heads/feature", vcs("rev-parse", "HEAD~2"))).toBe(
        "origin/main",
      );
    });

    it("is the commit before the push on main, so every commit of a multi-commit push is checked", () => {
      expect(baseFor("refs/heads/main", vcs("rev-parse", "HEAD~2"))).toBe(
        vcs("rev-parse", "HEAD~2"),
      );
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
    const preview = job("preview", previewWorkflow);

    expect(preview).toMatch(/Previews share the single Supabase project/);
    expect(preview).toMatch(/vercel pull --environment=preview/);
    expect(preview).toMatch(/DATABASE_URL and SUPABASE_SECRET_KEY/);
    expect(preview).toMatch(/keeps PRODUCTION_DATABASE_URL/);
    expect(preview).toMatch(/team-scoped/);
    expect(preview).not.toMatch(/must never hold production secrets/);
  });

  it("gives the production secrets only to a job in the production environment, and the preview job the preview one", () => {
    const parsed = parse(workflow).jobs;
    const preview = parse(previewWorkflow).jobs;

    expect(parsed.production.environment).toEqual({
      name: "production",
      url: "${{ vars.PRODUCTION_URL }}",
    });
    expect(preview.preview.environment).toBe("preview");
    expect(parsed.checks.environment).toBeUndefined();
    // Only the production and preview jobs read secrets; the settings check works for repository or environment secrets alike.
    for (const name of Object.keys(parsed)) {
      if (name === "production") continue;
      expect(JSON.stringify(parsed[name]), name).not.toMatch(/secrets\./);
    }
    expect(job("production")).toMatch(
      /HAS_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN != '' \}\}/,
    );
    expect(job("preview", previewWorkflow)).toMatch(
      /HAS_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN != '' \}\}/,
    );
    // The workflows that read neither secrets nor an environment.
    for (const file of [
      "checks.yml",
      "nightly.yml",
      "search-latency.yml",
      "codeql.yml",
    ]) {
      const text = readFileSync(path.join(workflowDir, file), "utf8");
      expect(text, file).not.toMatch(/secrets\./);
      expect(text, file).not.toMatch(/^\s+environment:/m);
    }
  });

  it("runs the preview gates, which get a token, from main's scripts rather than the branch's", () => {
    const preview = steps(job("preview", previewWorkflow));
    const trusted = preview[stepIndex(preview, /ref: main\b/)];
    const gate = preview[stepIndex(preview, /preview-gate\.sh/)];

    expect(trusted).toMatch(/uses: actions\/checkout@/);
    expect(trusted).toMatch(/path: trusted/);
    expect(trusted).toMatch(/persist-credentials: false/);
    expect(stepIndex(preview, /ref: main\b/)).toBeLessThan(
      stepIndex(preview, /preview-ready\.sh/),
    );
    expect(stepIndex(preview, /ref: main\b/)).toBeLessThan(
      stepIndex(preview, /preview-gate\.sh/),
    );
    expect(gate).toMatch(/run: trusted\/scripts\/ci\/preview-gate\.sh/);
    expect(gate).toMatch(/VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
  });

  it("keeps main's trusted checkout out of the preview build's type check", () => {
    // A sparse checkout still brings main's root files, next.config.ts among them; the build must not compile them.
    const tsconfig = JSON.parse(
      readFileSync(path.join(__dirname, "..", "tsconfig.json"), "utf8"),
    );
    expect(tsconfig.exclude).toContain("trusted");
  });

  it("checks destructive changes against what each migration removed from the CI database", () => {
    const all = steps(job("database", checksWorkflow));
    const migrateStep = all[stepIndex(all, /npm run db:migrate/)];
    const destructive = all[stepIndex(all, /npm run db:check-destructive/)];

    expect(migrateStep).toMatch(
      /npm run db:migrate -- --removals-report "\$RUNNER_TEMP\/migration-removals\.json"/,
    );
    expect(destructive).toMatch(
      /--removals "\$RUNNER_TEMP\/migration-removals\.json"/,
    );
    expect(stepIndex(all, /npm run db:migrate/)).toBeLessThan(
      stepIndex(all, /npm run db:check-destructive/),
    );
  });

  it("uploads each deployment as one tarball, because the Hobby plan caps daily file uploads", () => {
    const deploys =
      (workflow + previewWorkflow).match(/vercel deploy .*/g) ?? [];

    expect(deploys).toHaveLength(2);
    for (const command of deploys)
      expect(command).toMatch(/^vercel deploy --prebuilt --archive=tgz /);
    expect(job("production")).toMatch(
      /vercel deploy --prebuilt --archive=tgz --prod --skip-domain --json/,
    );
  });
});

describe("the checks jobs", () => {
  const parsed = parse(checksWorkflow);

  it("are Static, Database and Browser, each with its own timeout, and run at once (none needs another)", () => {
    expect(Object.keys(parsed.jobs)).toEqual(["static", "database", "browser"]);
    expect(
      Object.values(parsed.jobs).map((j) => (j as { name: string }).name),
    ).toEqual(["Static", "Database", "Browser"]);
    for (const [name, j] of Object.entries(
      parsed.jobs as Record<
        string,
        { needs?: unknown; "timeout-minutes"?: number }
      >,
    )) {
      expect(j.needs, name).toBeUndefined();
      expect(j["timeout-minutes"], name).toBeGreaterThan(0);
    }
  });

  it("give the Database and Browser jobs the same pinned database image, and install no browser", () => {
    const images = ["database", "browser"].map(
      (name) => parsed.jobs[name].services.postgres.image,
    );

    expect(images[0]).toMatch(/^supabase\/postgres:\d/);
    expect(images[1]).toBe(images[0]);
    expect(checksWorkflow).not.toMatch(/playwright install/);
  });

  it("build once in the Browser job, before the suites that use the build", () => {
    const all = steps(job("browser", checksWorkflow));
    const build = stepIndex(all, /npm run build/);

    expect(checksWorkflow.match(/npm run build/g)).toHaveLength(1);
    for (const script of [
      "test:staff:docker",
      "test:resident:docker",
      "test:hub:docker",
      "test:smoke",
    ]) {
      expect(build, script).toBeLessThan(
        stepIndex(all, new RegExp(`npm run ${script}`)),
      );
    }
    expect(all[stepIndex(all, /actions\/upload-artifact/)]).toMatch(
      /if: \$\{\{ failure\(\) \|\| cancelled\(\) \}\}/,
    );
  });

  it("run both screenshot suites even after an earlier failure, each in its own output folder, so one run uploads every difference", () => {
    const all = steps(job("browser", checksWorkflow));
    const root = path.join(__dirname, "..");
    for (const suite of ["resident", "hub"]) {
      expect(all[stepIndex(all, new RegExp(`npm run test:${suite}:docker`))], suite).toMatch(/if: \$\{\{ !cancelled\(\) \}\}/);
      expect(readFileSync(path.join(root, `playwright.${suite}.config.ts`), "utf8"), suite).toMatch(
        new RegExp(`outputDir: "test-results/${suite}"`),
      );
      // Soft, never skipped: a mismatch still fails the test (and so this job), after the test's later screenshots are taken.
      const helpers = readFileSync(path.join(root, "e2e", suite, "helpers.ts"), "utf8");
      expect(helpers, suite).toMatch(/await expect\.soft\(page\)\.toHaveScreenshot\(/);
      expect(helpers, suite).not.toMatch(/continue-on-error|test\.fail|\.skip\(|ignoreSnapshots/);
    }
    expect(all[stepIndex(all, /actions\/upload-artifact/)]).toMatch(/path: test-results\/$/m);
  });

  it("never run the one real search (no SMOKE_SEARCH): the build has no Cohere key", () => {
    expect(checksWorkflow).not.toMatch(/SMOKE_SEARCH/);
  });

  it("are reused by the nightly backstop, which deploys nothing", () => {
    const nightly = readFileSync(path.join(workflowDir, "nightly.yml"), "utf8");

    expect(parse(nightly).on.schedule).toHaveLength(1);
    expect(parse(nightly).jobs.checks.uses).toBe(
      "./.github/workflows/checks.yml",
    );
    expect(nightly).not.toMatch(/vercel|secrets\.|environment:/);
  });
});

describe('the "Checks" aggregate and the tested-tree skip', () => {
  const parsed = parse(workflow).jobs;

  it("is a job named exactly Checks that runs unless cancelled and needs the tested-tree decision and the suite", () => {
    expect(parsed.checks.name).toBe("Checks");
    expect(parsed.checks.if).toBe("${{ !cancelled() }}");
    expect(parsed.checks.needs).toEqual(["tested-tree", "suite"]);
    expect(parsed.suite.uses).toBe("./.github/workflows/checks.yml");
    expect(
      Object.values(parsed).filter(
        (j) => (j as { name?: string }).name === "Checks",
      ),
    ).toHaveLength(1);
  });

  it("passes when the suite succeeded, or was skipped after a tested-tree skip, and fails otherwise", () => {
    const script = parsed.checks.steps[0].run as string;
    const run = (env: Record<string, string>) => {
      const dir = mkdtempSync(path.join(tmpdir(), "ci-aggregate-"));
      try {
        return spawnSync("bash", ["-e", "-c", script], {
          encoding: "utf8",
          env: {
            NODE_ENV: "test",
            PATH: process.env.PATH ?? "",
            GITHUB_STEP_SUMMARY: path.join(dir, "summary"),
            ...env,
          },
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    expect(
      run({ SKIP: "", TESTED_SHA: "", SUITE_RESULT: "success" }).status,
    ).toBe(0);
    const skipped = run({
      SKIP: "true",
      TESTED_SHA: "abc123",
      SUITE_RESULT: "skipped",
    });
    expect(skipped.status).toBe(0);
    expect(skipped.stdout).toContain("tested at abc123");
    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(
        run({ SKIP: "", TESTED_SHA: "", SUITE_RESULT: result }).status,
        result,
      ).toBe(1);
    }
    expect(
      run({ SKIP: "true", TESTED_SHA: "abc", SUITE_RESULT: "failure" }).status,
    ).toBe(1);
  });

  it("decides the skip on main only, before the suite, with read-only scopes and the script of the commit itself", () => {
    const decide = parsed["tested-tree"];

    expect(decide.if).toBe("github.ref == 'refs/heads/main'");
    expect(decide.permissions).toEqual({
      contents: "read",
      checks: "read",
      actions: "read",
    });
    expect(parsed.suite.needs).toBe("tested-tree");
    expect(parsed.suite.if).toBe(
      "${{ !cancelled() && needs.tested-tree.outputs.skip != 'true' }}",
    );
    expect(decide.steps.at(-1).run).toBe("scripts/ci/tested-tree.sh");
    expect(decide.steps.at(-1).env).toEqual({
      GITHUB_TOKEN: "${{ github.token }}",
    });
  });

  it("deploys production only after Checks, and keeps the order and guards of the deploy", () => {
    const production = parsed.production;

    expect(production.needs).toBe("checks");
    // Explicit status function and direct result: the implicit success() would also see the skipped suite of a tested tree.
    expect(production.if).toContain("!cancelled()");
    expect(production.if).toContain("github.ref == 'refs/heads/main'");
    expect(production.if).toContain("needs.checks.result == 'success'");
    const all = steps(job("production"));
    const order = [
      /main-head\.sh/,
      /rollback-target\.sh/,
      /vercel build --prod/,
      /npm run db:migrate/,
      /name: Deploy$/m,
      /main-head\.sh/,
      /vercel promote/,
      /npm run test:smoke/,
      /vercel rollback/,
    ];
    let at = -1;
    for (const pattern of order) {
      const index = all.findIndex((step, i) => i > at && pattern.test(step));
      expect(index, String(pattern)).toBeGreaterThan(at);
      at = index;
    }
  });

  it("keeps the real search out of the rollback smoke check and runs it after, alert only, unless SMOKE_SEARCH is off", () => {
    const all = steps(job("production"));
    const smokeAt = stepIndex(all, /name: Smoke check production/);
    const rollbackAt = stepIndex(
      all,
      /name: Roll back after a failed smoke check/,
    );
    const searchAt = stepIndex(all, /name: Search smoke \(alert only\)/);

    expect(all[smokeAt]).toMatch(/SMOKE_SEARCH: "off"/);
    expect(searchAt).toBeGreaterThan(rollbackAt);
    expect(all[searchAt]).toMatch(/continue-on-error: true/);
    expect(all[searchAt]).toMatch(/steps\.smoke\.outcome == 'success'/);
    expect(all[searchAt]).toMatch(/vars\.SMOKE_SEARCH != 'off'/);
    expect(all[searchAt]).toMatch(/SMOKE_SEARCH: "on"/);
  });
});

describe("the preview workflow", () => {
  const parsed = parse(previewWorkflow);
  const preview = job("preview", previewWorkflow);
  const all = steps(preview);

  it("runs on a pull request label or push only, and never on a push to a branch", () => {
    expect(parsed.on).toEqual({
      pull_request: { types: ["labeled", "synchronize"] },
    });
    expect(Object.keys(parse(workflow).jobs)).not.toContain("preview");
    expect(workflow).not.toMatch(
      /vercel deploy --prebuilt --archive=tgz\s*--json/,
    );
  });

  it("builds only for the label preview, from this repository, and only while the pull request is labelled", () => {
    const condition = parsed.jobs.preview.if as string;

    expect(condition).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(condition).toContain(
      "contains(github.event.pull_request.labels.*.name, 'preview')",
    );
    expect(condition).toContain(
      "github.event.action != 'labeled' || github.event.label.name == 'preview'",
    );
    // On the job, not the workflow: a run skipped for another label must not cancel a running preview.
    expect(parsed.concurrency).toBeUndefined();
    expect(parsed.jobs.preview.concurrency).toEqual({
      group: "preview-${{ github.event.pull_request.number }}",
      "cancel-in-progress": true,
    });
  });

  it("checks out the pull request's head commit, not the merge ref, and reads the label, origin and Checks with main's script", () => {
    const head =
      all[
        stepIndex(
          all,
          /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/,
        )
      ];
    const ready = all[stepIndex(all, /preview-ready\.sh/)];

    expect(head).toMatch(/uses: actions\/checkout@/);
    expect(ready).toMatch(/run: trusted\/scripts\/ci\/preview-ready\.sh/);
    expect(ready).toMatch(/GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
    expect(ready).toMatch(
      /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/,
    );
    expect(stepIndex(all, /ref: main\b/)).toBeLessThan(
      stepIndex(all, /preview-ready\.sh/),
    );
    expect(stepIndex(all, /preview-ready\.sh/)).toBeLessThan(
      stepIndex(all, /preview-gate\.sh/),
    );
    expect(all[stepIndex(all, /preview-gate\.sh/)]).toMatch(
      /if: steps\.pr\.outputs\.ready == 'true'/,
    );
    expect(preview).not.toMatch(/continue-on-error/);
  });

  it("has read-only token scopes", () => {
    expect(parsed.jobs.preview.permissions).toEqual({
      contents: "read",
      "pull-requests": "read",
      checks: "read",
      actions: "read",
    });
    expect(job("production")).not.toMatch(/pull-requests/);
  });

  it("runs the one real search in a preview only when SMOKE_SEARCH_PREVIEW is on", () => {
    const smoke = all[stepIndex(all, /npm run test:smoke/)];

    expect(smoke).toMatch(
      /SMOKE_SEARCH: \$\{\{ vars\.SMOKE_SEARCH_PREVIEW == 'on' && vars\.SMOKE_SEARCH != 'off' && 'on' \|\| 'off' \}\}/,
    );
  });
});

describe("every workflow", () => {
  const files = readdirSync(workflowDir).filter((file) =>
    file.endsWith(".yml"),
  );

  it.each(files)(
    "%s pins each third-party action to a full commit SHA, with its version in a comment",
    (file) => {
      const text = readFileSync(path.join(workflowDir, file), "utf8");
      const uses = [...text.matchAll(/^\s*(?:- )?uses: (\S+)(.*)$/gm)].filter(
        (match) => !match[1].startsWith("./"),
      );

      for (const [, ref, rest] of uses) {
        expect(ref, `${file}: ${ref}`).toMatch(
          /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/,
        );
        expect(rest, `${file}: ${ref}`).toMatch(/^ # v\d+\.\d+\.\d+$/);
      }
    },
  );

  it("use one commit for each action", () => {
    const seen = new Map<string, string>();
    for (const file of files) {
      const text = readFileSync(path.join(workflowDir, file), "utf8");
      for (const [, name, sha, version] of text.matchAll(
        /uses: ([\w.-]+\/[\w./-]+)@([0-9a-f]{40}) # (v[\d.]+)/g,
      )) {
        const key = `${name} ${version}`;
        expect(seen.get(key) ?? sha, key).toBe(sha);
        seen.set(key, sha);
      }
    }
  });
});

describe("dependabot and code scanning", () => {
  it("update npm and the actions weekly, in groups of minor and patch updates, with few open pull requests", () => {
    const config = parse(
      readFileSync(
        path.join(__dirname, "..", ".github", "dependabot.yml"),
        "utf8",
      ),
    );

    expect(
      config.updates.map(
        (u: { "package-ecosystem": string }) => u["package-ecosystem"],
      ),
    ).toEqual(["npm", "github-actions"]);
    for (const update of config.updates) {
      expect(update.schedule.interval).toBe("weekly");
      expect(update["open-pull-requests-limit"]).toBeLessThanOrEqual(3);
      expect(Object.values(update.groups)).toEqual([
        { "update-types": ["minor", "patch"] },
      ]);
    }
  });

  it("scans JavaScript and TypeScript on main, pull requests and weekly, apart from the checks a deploy waits for", () => {
    const codeql = parse(
      readFileSync(path.join(workflowDir, "codeql.yml"), "utf8"),
    );

    expect(Object.keys(codeql.on).sort()).toEqual([
      "pull_request",
      "push",
      "schedule",
    ]);
    expect(codeql.on.push.branches).toEqual(["main"]);
    expect(JSON.stringify(codeql)).toContain("javascript-typescript");
    expect(JSON.stringify(parse(workflow))).not.toMatch(/codeql/i);
  });
});
