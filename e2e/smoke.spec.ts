import { appendFileSync } from "node:fs";
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  SEARCH_QUESTION,
  answerProblem,
  serverTimingTotal,
  timingLines,
} from "../scripts/ci/search-probe.mjs";

const expectedVersion = process.env.EXPECTED_VERSION;

// A redirect counts as a failure: each path must answer by itself.
const get = (request: APIRequestContext, path: string) =>
  request.get(path, { maxRedirects: 0 });

test("home page responds", async ({ request }) => {
  const response = await get(request, "/");

  expect(response.status()).toBe(200);
});

test("health reports ok and the deployed version", async ({ request }) => {
  const response = await get(request, "/api/health");

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    status: "ok",
    version: expectedVersion ?? expect.any(String),
  });
});

test("staff pages send visitors without a session to sign-in, and are never stored", async ({
  request,
}) => {
  const response = await get(request, "/staff/people");

  expect(response.status()).toBe(307);
  expect(
    new URL(response.headers()["location"] ?? "", "http://host").pathname,
  ).toBe("/staff/sign-in");
  expect(response.headers()["cache-control"] ?? "").toMatch(
    /(^|,)\s*no-store\s*(,|$)/i,
  );
});

test("staff sign-in is never stored", async ({ request }) => {
  const response = await get(request, "/staff/sign-in");

  expect(response.status()).toBe(200);
  const directives = (response.headers()["cache-control"] ?? "")
    .split(",")
    .map((directive) => directive.trim().toLowerCase());
  expect(directives).toContain("no-store");
});

// One real search in English: it spends a Cohere call, so it runs only where the workflow asks for it (SMOKE_SEARCH=on): the
// production job (a repository variable SMOKE_SEARCH=off turns it off) and a preview when SMOKE_SEARCH_PREVIEW=on is set. The
// checks' own smoke of the local build never sets it (no key there). It records the response time and Server-Timing total.
// No retries: a failed search would otherwise spend up to three Cohere calls per deploy.
test.describe("search", () => {
  test.describe.configure({ retries: 0 });
  test("search answers a question in English", async ({ request }) => {
    test.skip(
      process.env.SMOKE_SEARCH !== "on",
      "SMOKE_SEARCH is not on for this target",
    );

    const started = performance.now();
    const response = await request.post("/api/search", {
      data: { q: SEARCH_QUESTION, lang: "en" },
      maxRedirects: 0,
    });
    const responseMs = performance.now() - started;
    const body: unknown = await response.json().catch(() => null);
    const totalMs = serverTimingTotal(response.headers()["server-timing"]);

    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary)
      appendFileSync(
        summary,
        timingLines("Search smoke", { responseMs, totalMs }).join("\n") + "\n",
      );
    console.log(
      `search smoke: response ${Math.round(responseMs)} ms, Server-Timing total ${totalMs ?? "not reported"} ms`,
    );

    expect(answerProblem(response.status(), body)).toBeNull();
  });
});
