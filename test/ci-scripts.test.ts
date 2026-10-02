import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPTS = path.join(__dirname, "..", "scripts", "ci");
const PROJECT = "prj_cvh";
const PREVIOUS = "dpl_previous";

// Stand-ins for curl and git. Responses come from STUB_* variables; a status of
// 000 means no response arrived (DNS or connection failure).
const CURL_STUB = `#!/usr/bin/env bash
out=; url=
while [ $# -gt 0 ]; do
  case "$1" in -o) out=$2; shift 2 ;; -K|-w|-H) shift 2 ;; -*) shift ;; *) url=$1; shift ;; esac
done
case "$url" in
  */v4/aliases/*) response=$STUB_ALIAS ;;
  */v7/deployments*) response=$STUB_LIST ;;
  */pulls\\?*) echo "$url" > "$STUB_URL_LOG"; response=$STUB_PULLS ;;
  *) echo "unexpected request $url" >&2; exit 2 ;;
esac
status=\${response%%|*}
printf '%s' "\${response#*|}" > "$out"
printf '%s' "$status"
[ "$status" != 000 ] || { echo "curl: (6) Could not resolve host" >&2; exit 6; }
`;

const GIT_STUB = `#!/usr/bin/env bash
[ "$1 $2 $3" = "ls-remote origin refs/heads/main" ] || { echo "unexpected git $*" >&2; exit 2; }
[ -z "$STUB_GIT_FAIL" ] || { echo "fatal: unable to access" >&2; exit 128; }
[ -z "$STUB_MAIN_HEAD" ] || printf '%s\\trefs/heads/main\\n' "$STUB_MAIN_HEAD"
`;

let stubs: string;

beforeAll(() => {
  stubs = mkdtempSync(path.join(tmpdir(), "ci-stubs-"));
  for (const [name, body] of [["curl", CURL_STUB], ["git", GIT_STUB]]) {
    writeFileSync(path.join(stubs, name), body);
    chmodSync(path.join(stubs, name), 0o755);
  }
});

afterAll(() => {
  rmSync(stubs, { recursive: true, force: true });
});

function run(script: string, env: Record<string, string>) {
  const output = path.join(stubs, `output-${script}-${Math.round(performance.now() * 1000)}`);
  writeFileSync(output, "");
  const result = spawnSync("bash", [path.join(SCRIPTS, script)], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: `${stubs}:${process.env.PATH}`,
      VERCEL_TOKEN: "token",
      VERCEL_ORG_ID: "team_cvh",
      VERCEL_PROJECT_ID: PROJECT,
      PRODUCTION_URL: "https://cvh.example.ca",
      GITHUB_OUTPUT: output,
      GITHUB_SHA: "newsha",
      GITHUB_TOKEN: "ghs_token",
      GITHUB_REPOSITORY: "Climate-Resilient-Communities/cvh",
      GITHUB_REF_NAME: "feat/x",
      STUB_URL_LOG: path.join(stubs, "url-log"),
      ...env,
    },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, output: readFileSync(output, "utf8") };
}

const aliasFor = (projectId: string, deploymentId: string | null = PREVIOUS) =>
  `200|${JSON.stringify({ alias: "cvh.example.ca", projectId, deploymentId })}`;
const ALIAS_MISSING = "404|{}";
const NO_PRODUCTION = `200|${JSON.stringify({ deployments: [], pagination: {} })}`;
const HAS_PRODUCTION = `200|${JSON.stringify({ deployments: [{ uid: "dpl_other", target: "production" }], pagination: {} })}`;

describe("production-state.sh", () => {
  it("reports the deployment serving the production URL for this project", () => {
    const result = run("production-state.sh", { STUB_ALIAS: aliasFor(PROJECT) });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(`present ${PREVIOUS}`);
  });

  it("reports an empty project only when Vercel lists no production deployment", () => {
    const result = run("production-state.sh", { STUB_ALIAS: ALIAS_MISSING, STUB_LIST: NO_PRODUCTION });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("empty");
  });

  it.each([
    ["the lookup gets no response (DNS failure)", { STUB_ALIAS: "000|" }],
    ["the lookup returns a server error", { STUB_ALIAS: "500|{}" }],
    ["the token is refused", { STUB_ALIAS: "403|{}" }],
    ["the domain belongs to another project", { STUB_ALIAS: aliasFor("prj_other") }],
    ["the domain has no deployment assigned", { STUB_ALIAS: aliasFor(PROJECT, null) }],
    ["the domain is unassigned but production deployments exist", { STUB_ALIAS: ALIAS_MISSING, STUB_LIST: HAS_PRODUCTION }],
    ["the domain is unassigned and the listing fails", { STUB_ALIAS: ALIAS_MISSING, STUB_LIST: "000|" }],
    ["the domain is unassigned and the listing is not JSON", { STUB_ALIAS: ALIAS_MISSING, STUB_LIST: "200|<html>" }],
  ])("is unknown (non-zero, no state printed) when %s", (_case, env) => {
    const result = run("production-state.sh", env);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
  });
});

describe("preview-gate.sh", () => {
  it("deploys a preview only when production positively has a deployment", () => {
    const result = run("preview-gate.sh", { STUB_ALIAS: aliasFor(PROJECT) });
    expect(result.code).toBe(0);
    expect(result.output).toBe("deploy=true\n");
  });

  it.each([
    ["the project is empty", { STUB_ALIAS: ALIAS_MISSING, STUB_LIST: NO_PRODUCTION }],
    ["the lookup gets no response (DNS failure)", { STUB_ALIAS: "000|" }],
    ["an ordinary 404 cannot be explained", { STUB_ALIAS: ALIAS_MISSING, STUB_LIST: HAS_PRODUCTION }],
  ])("skips the preview with a warning when %s", (_case, env) => {
    const result = run("preview-gate.sh", env);
    expect(result.code).toBe(0);
    expect(result.output).toBe("deploy=false\n");
    expect(result.stdout).toContain("::warning title=Vercel preview not built::");
  });
});

describe("open-pr-gate.sh", () => {
  it("deploys a preview when the branch has an open pull request in this repository", () => {
    const result = run("open-pr-gate.sh", { STUB_PULLS: `200|${JSON.stringify([{ number: 22 }])}` });
    expect(result.code).toBe(0);
    expect(result.output).toBe("open=true\n");
    expect(readFileSync(path.join(stubs, "url-log"), "utf8").trim()).toBe(
      "https://api.github.com/repos/Climate-Resilient-Communities/cvh/pulls?state=open&per_page=1&head=Climate-Resilient-Communities%3Afeat%2Fx",
    );
  });

  it("skips the preview with a notice when no pull request is open", () => {
    const result = run("open-pr-gate.sh", { STUB_PULLS: "200|[]" });
    expect(result.code).toBe(0);
    expect(result.output).toBe("open=false\n");
    expect(result.stdout).toContain("::notice title=Vercel preview skipped::");
    expect(result.stdout).not.toContain("::warning");
  });

  it.each([
    ["the API returns a server error", "502|{}"],
    ["the token is refused", '403|{"message":"Resource not accessible"}'],
    ["the lookup gets no response (DNS failure)", "000|"],
    ["the response is not a list", "200|<html>"],
  ])("skips the preview with a warning, not a failure, when %s", (_case, pulls) => {
    const result = run("open-pr-gate.sh", { STUB_PULLS: pulls });
    expect(result.code).toBe(0);
    expect(result.output).toBe("open=false\n");
    expect(result.stdout).toContain("::warning title=Vercel preview skipped::");
  });
});

describe("rollback-target.sh", () => {
  it("records the deployment serving production", () => {
    const result = run("rollback-target.sh", { STUB_ALIAS: aliasFor(PROJECT) });
    expect(result.code).toBe(0);
    expect(result.output).toBe(`id=${PREVIOUS}\n`);
  });

  it("deploys without a rollback target only for an empty project", () => {
    const result = run("rollback-target.sh", { STUB_ALIAS: ALIAS_MISSING, STUB_LIST: NO_PRODUCTION });
    expect(result.code).toBe(0);
    expect(result.output).toBe("id=\n");
    expect(result.stdout).toContain("::warning title=No rollback target::");
  });

  it.each([
    ["the lookup gets no response (DNS failure)", { STUB_ALIAS: "000|" }],
    ["the alias is missing while production deployments exist", { STUB_ALIAS: ALIAS_MISSING, STUB_LIST: HAS_PRODUCTION }],
    ["the lookup returns a server error", { STUB_ALIAS: "502|{}" }],
  ])("stops the deploy when %s", (_case, env) => {
    const result = run("rollback-target.sh", env);
    expect(result.code).not.toBe(0);
    expect(result.output).toBe("");
    expect(result.stdout).toContain("::error title=Production not deployed::");
  });
});

describe("main-head.sh", () => {
  it("allows a commit that is still the head of main", () => {
    const result = run("main-head.sh", { STUB_MAIN_HEAD: "newsha" });
    expect(result.code).toBe(0);
    expect(result.output).toBe("current=true\n");
  });

  it("rejects an older commit, as from a late or re-run workflow", () => {
    const result = run("main-head.sh", { STUB_MAIN_HEAD: "newersha", GITHUB_SHA: "oldsha" });
    expect(result.code).toBe(0);
    expect(result.output).toBe("current=false\n");
    expect(result.stdout).toContain("is no longer the head of main");
  });

  it.each([
    ["git cannot reach the repository", { STUB_GIT_FAIL: "1" }],
    ["main cannot be found", {}],
  ])("stops the deploy when %s", (_case, env) => {
    const result = run("main-head.sh", env);
    expect(result.code).not.toBe(0);
    expect(result.output).toBe("");
  });
});
