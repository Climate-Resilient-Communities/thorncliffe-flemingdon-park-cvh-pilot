// The trusted gates of the pipeline, run against a fake GitHub API on localhost and throwaway git repositories:
//   scripts/ci/tested-tree.sh   skip the checks of a push to main only when the tree was already tested
//   scripts/ci/preview-ready.sh build a preview only for a labelled pull request of this repository whose Checks succeeded
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const root = path.join(__dirname, "..");
const REPO = "owner/repo";

/** What the fake API answers: a path (with query) to a JSON body, or a status. */
const routes = new Map<string, { status: number; body: unknown }>();
const requested: string[] = [];
let server: Server;
let apiUrl: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    requested.push(request.url ?? "");
    const route = routes.get((request.url ?? "").replace(`/repos/${REPO}/`, ""));
    response.writeHead(route?.status ?? 404, { "content-type": "application/json" });
    response.end(JSON.stringify(route?.body ?? { message: "Not Found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  routes.clear();
  requested.length = 0;
});

const CHECKS_QUERY = (sha: string) => `commits/${sha}/check-runs?check_name=Checks&filter=all&per_page=100`;

/** A "Checks" check run of the github-actions app, as the API lists it. */
const checkRun = (over: Record<string, unknown> = {}) => ({
  name: "Checks",
  status: "completed",
  conclusion: "success",
  started_at: "2026-10-04T10:00:00Z",
  app: { slug: "github-actions" },
  html_url: `https://github.com/${REPO}/actions/runs/777/job/1`,
  ...over,
});

function answerChecks(sha: string, runs: unknown[], workflow: Record<string, unknown> = {}) {
  routes.set(CHECKS_QUERY(sha), { status: 200, body: { total_count: runs.length, check_runs: runs } });
  routes.set("actions/runs/777", { status: 200, body: { path: ".github/workflows/ci.yml", head_sha: sha, event: "push", ...workflow } });
}

async function run(script: string, cwd: string, env: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "ci-gate-out-"));
  const output = path.join(dir, "output");
  const summary = path.join(dir, "summary");
  writeFileSync(output, "");
  writeFileSync(summary, "");
  try {
    const result = await exec("bash", [path.join(root, "scripts", "ci", script)], {
      cwd,
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: dir, GITHUB_TOKEN: "t", GITHUB_REPOSITORY: REPO, GITHUB_API_URL: apiUrl, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, ...env },
    }).then(
      (ok) => ({ code: 0, stdout: ok.stdout, stderr: ok.stderr }),
      (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }),
    );
    const outputs = Object.fromEntries(
      readFileSync(output, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    return { ...result, outputs, summary: readFileSync(summary, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("scripts/ci/tested-tree.sh", () => {
  let repo: string;
  const vcs = async (...args: string[]) =>
    (await exec("git", ["-c", "user.email=a@b", "-c", "user.name=x", "-c", "commit.gpgsign=false", ...args], { cwd: repo })).stdout.trim();
  const commitFile = async (name: string, text: string) => {
    writeFileSync(path.join(repo, name), text);
    await vcs("add", name);
    await vcs("commit", "-q", "-m", `add ${name}`);
    return vcs("rev-parse", "HEAD");
  };

  beforeEach(async () => {
    repo = mkdtempSync(path.join(tmpdir(), "ci-tested-tree-"));
    await vcs("init", "-q", "-b", "main");
    await commitFile("base.txt", "base");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  /** A pull request branch with one commit, merged with a merge commit; returns the pull request's head. */
  async function mergePullRequest(mainMovedFirst = false) {
    await vcs("checkout", "-q", "-b", "pr");
    const head = await commitFile("feature.txt", "feature");
    await vcs("checkout", "-q", "main");
    if (mainMovedFirst) await commitFile("other.txt", "other");
    await vcs("merge", "-q", "--no-ff", "-m", "Merge pull request #1", "pr");
    return head;
  }

  const decide = () => run("tested-tree.sh", repo, {});

  it("skips when HEAD is a merge commit with the tree of the merged head, whose Checks succeeded, and says so", async () => {
    const head = await mergePullRequest();
    answerChecks(head, [checkRun()]);

    const result = await decide();

    expect(result.code).toBe(0);
    expect(result.outputs).toEqual({ skip: "true", tested_sha: head });
    expect(result.summary).toContain(`Tested at ${head}`);
  });

  it("runs the checks when main had moved on, so the merge's tree is not the tree that was tested", async () => {
    const head = await mergePullRequest(true);
    answerChecks(head, [checkRun()]);

    const result = await decide();

    expect(result.outputs).toEqual({ skip: "false" });
    expect(result.summary).toMatch(/differs from the tree of the merged head/);
    expect(requested, "no API call is needed once the trees differ").toEqual([]);
  });

  it("runs the checks for a commit that is not a merge (a squash or a direct push)", async () => {
    await commitFile("direct.txt", "direct");

    const result = await decide();

    expect(result.outputs).toEqual({ skip: "false" });
    expect(result.summary).toMatch(/Not a merge commit/);
  });

  it.each([
    ["no Checks run yet", [], /no completed "Checks" run/],
    ["Checks still running", [checkRun({ status: "in_progress", conclusion: null })], /no completed "Checks" run/],
    ["Checks failed", [checkRun({ conclusion: "failure" })], /did not succeed/],
    ["Checks cancelled", [checkRun({ conclusion: "cancelled" })], /did not succeed/],
    ["the latest Checks failed after an earlier success (a re-run)", [checkRun(), checkRun({ conclusion: "failure", started_at: "2026-10-04T11:00:00Z" })], /did not succeed/],
    ["a Checks run of another app", [checkRun({ app: { slug: "some-other-app" } })], /no completed "Checks" run/],
  ])("runs the checks when the merged head has %s", async (_name, runs, reason) => {
    const head = await mergePullRequest();
    answerChecks(head, runs);

    const result = await decide();

    expect(result.outputs).toEqual({ skip: "false" });
    expect(result.summary).toMatch(reason);
  });

  it.each([
    ["another workflow", { path: ".github/workflows/other.yml" }],
    ["another commit", { head_sha: "f".repeat(40) }],
    ["a pull_request event", { event: "pull_request" }],
  ])("runs the checks when the successful Checks job belongs to %s, not to this repository's CI push run", async (_name, workflow) => {
    const head = await mergePullRequest();
    answerChecks(head, [checkRun()], workflow);

    const result = await decide();

    expect(result.outputs).toEqual({ skip: "false" });
    expect(result.summary).toMatch(/Could not confirm/);
  });

  it("runs the checks, and does not fail, when the API cannot be read", async () => {
    await mergePullRequest();

    const result = await decide();

    expect(result.code).toBe(0);
    expect(result.outputs).toEqual({ skip: "false" });
  });

  it("runs the checks when the merged head is not in the fetched history", async () => {
    const head = await mergePullRequest();
    // A shallow clone of the merge commit alone, as a fetch-depth: 1 checkout would be.
    const shallow = mkdtempSync(path.join(tmpdir(), "ci-tested-tree-shallow-"));
    try {
      await exec("git", ["clone", "-q", "--depth", "1", `file://${repo}`, shallow]);
      answerChecks(head, [checkRun()]);

      const result = await run("tested-tree.sh", shallow, {});

      expect(result.outputs.skip).toBe("false");
    } finally {
      rmSync(shallow, { recursive: true, force: true });
    }
  });
});

describe("scripts/ci/preview-ready.sh", () => {
  const SHA = "a".repeat(40);
  const pull = (over: Record<string, unknown> = {}) => ({
    state: "open",
    labels: [{ name: "preview" }],
    head: { sha: SHA, repo: { full_name: REPO } },
    ...over,
  });
  const ready = (env: Record<string, string> = {}) =>
    run("preview-ready.sh", root, { PR_NUMBER: "5", HEAD_SHA: SHA, PREVIEW_WAIT_SECONDS: "0", PREVIEW_POLL_SECONDS: "0", ...env });

  it("is ready for an open, labelled pull request from this repository whose head's Checks succeeded", async () => {
    routes.set("pulls/5", { status: 200, body: pull() });
    answerChecks(SHA, [checkRun()]);

    const result = await ready();

    expect(result.code).toBe(0);
    expect(result.outputs).toEqual({ ready: "true" });
  });

  it.each([
    ["it is closed", pull({ state: "closed" }), /is not open/],
    ["it has no preview label", pull({ labels: [{ name: "bug" }] }), /does not carry the label "preview"/],
    ["it comes from a fork", pull({ head: { sha: SHA, repo: { full_name: "someone/repo" } } }), /Previews are never built for forks/],
    ["its fork was deleted", pull({ head: { sha: SHA, repo: null } }), /Previews are never built for forks/],
    ["it has moved on to a newer commit", pull({ head: { sha: "b".repeat(40), repo: { full_name: REPO } } }), /has moved on/],
  ])("is not ready when %s (a warning, no failure)", async (_name, body, reason) => {
    routes.set("pulls/5", { status: 200, body });
    answerChecks(SHA, [checkRun()]);

    const result = await ready();

    expect(result.code).toBe(0);
    expect(result.outputs).toEqual({ ready: "false" });
    expect(result.stdout).toMatch(reason);
    expect(requested.some((url) => url.includes("check-runs")), "the checks are not even read").toBe(false);
  });

  it("is not ready when the pull request cannot be read", async () => {
    const result = await ready();

    expect(result.outputs).toEqual({ ready: "false" });
    expect(result.stdout).toMatch(/Could not read pull request #5 \(HTTP 404\)/);
  });

  it("fails the run, with an error, when the head's Checks failed", async () => {
    routes.set("pulls/5", { status: 200, body: pull() });
    answerChecks(SHA, [checkRun({ conclusion: "failure" })]);

    const result = await ready();

    expect(result.code).toBe(1);
    expect(result.outputs).toEqual({ ready: "false" });
    expect(result.stdout).toMatch(/::error title=Vercel preview not built::/);
  });

  it("gives up with a warning when the Checks are still pending after the wait", async () => {
    routes.set("pulls/5", { status: 200, body: pull() });
    answerChecks(SHA, [checkRun({ status: "in_progress", conclusion: null })]);

    const result = await ready();

    expect(result.code).toBe(0);
    expect(result.outputs).toEqual({ ready: "false" });
    expect(result.stdout).toMatch(/had not finished after 0s/);
  });

  it("waits for Checks that have not started, and does not take another workflow's Checks job for them", async () => {
    routes.set("pulls/5", { status: 200, body: pull() });
    answerChecks(SHA, [], {});

    expect((await ready()).outputs).toEqual({ ready: "false" });

    answerChecks(SHA, [checkRun()], { path: ".github/workflows/other.yml" });

    expect((await ready()).outputs).toEqual({ ready: "false" });
  });
});
