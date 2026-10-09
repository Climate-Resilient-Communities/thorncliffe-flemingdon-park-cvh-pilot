#!/usr/bin/env node
// Takes every new screenshot of one failed CI run as the committed baselines (docs/config.md, "Screenshot baselines").
//
//   node scripts/ci/baselines-from-run.mjs <run id>         download that run's browser-test-results artifact (gh), then copy
//   node scripts/ci/baselines-from-run.mjs --dir <folder>   the same from an artifact already downloaded or a local test-results/
//
// The artifact holds test-results/resident and test-results/hub (each suite's outputDir), one folder per test attempt:
// <test>, <test>-retry1, <test>-retry2. Only each test's last attempt is taken: it is the attempt that decided the
// test failed, so a picture that matched on a retry (a flaky one) is never taken. A picture whose page never held still
// (Playwright also wrote a -previous.png) is not taken either. Read the diffs before committing what this copies.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SUITES = ["resident", "hub"];

/** The folder of each test's last attempt, from the names of a suite's attempt folders. */
export function lastAttempts(folders) {
  const last = new Map();
  for (const folder of folders) {
    const match = /^(.*?)(?:-retry(\d+))?$/.exec(folder);
    const test = match[1];
    const attempt = Number(match[2] ?? 0);
    if (!last.has(test) || last.get(test).attempt < attempt) last.set(test, { folder, attempt });
  }
  return [...last.values()].map((entry) => entry.folder).sort();
}

/** The baselines an attempt folder's files replace: { actual, baseline } per -actual.png, and the unstable ones skipped. */
export function actualsIn(files) {
  const take = [];
  const unstable = [];
  for (const file of files) {
    if (!file.endsWith("-actual.png")) continue;
    const stem = file.slice(0, -"-actual.png".length);
    if (files.includes(`${stem}-previous.png`)) unstable.push(`${stem}.png`);
    else take.push({ actual: file, baseline: `${stem}.png` });
  }
  return { take, unstable };
}

function folders(dir) {
  return readdirSync(dir).filter((name) => statSync(path.join(dir, name)).isDirectory());
}

function main(argv) {
  let dir;
  if (argv[0] === "--dir" && argv[1]) {
    dir = path.resolve(argv[1]);
  } else if (/^\d+$/.test(argv[0] ?? "")) {
    dir = mkdtempSync(path.join(tmpdir(), "cvh-baselines-"));
    console.log(`Downloading browser-test-results of run ${argv[0]} into ${dir}`);
    execFileSync("gh", ["run", "download", argv[0], "-n", "browser-test-results", "-D", dir], { stdio: "inherit" });
  } else {
    console.error("usage: node scripts/ci/baselines-from-run.mjs <run id> | --dir <folder>");
    return 2;
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  let copied = 0;
  let problems = 0;
  for (const suite of SUITES) {
    const suiteDir = path.join(dir, suite);
    if (!existsSync(suiteDir)) continue;
    const taken = new Map();
    for (const folder of lastAttempts(folders(suiteDir))) {
      const { take, unstable } = actualsIn(readdirSync(path.join(suiteDir, folder)));
      for (const name of unstable) console.log(`  not taken, never held still (rerun it): ${suite} ${name} (${folder})`);
      for (const { actual, baseline } of take) {
        const from = path.join(suiteDir, folder, actual);
        const earlier = taken.get(baseline);
        if (earlier && !readFileSync(earlier).equals(readFileSync(from))) {
          console.error(`  two tests took different pictures for ${suite} ${baseline}: ${earlier} and ${from}`);
          problems += 1;
          continue;
        }
        taken.set(baseline, from);
        const to = path.join(root, "e2e", suite, "__screenshots__", baseline);
        console.log(`  ${existsSync(to) ? "updated" : "new    "} e2e/${suite}/__screenshots__/${baseline}`);
        copyFileSync(from, to);
        copied += 1;
      }
    }
  }
  if (copied === 0) console.log("No -actual.png in the last attempt of any test: no baseline changed.");
  else console.log(`${copied} baseline(s) copied. Look at them (git diff --stat, and the -diff.png files), then commit.`);
  return problems > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
