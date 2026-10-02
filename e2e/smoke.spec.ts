import { expect, test, type APIRequestContext } from "@playwright/test";

const expectedVersion = process.env.EXPECTED_VERSION;

// A redirect counts as a failure: each path must answer by itself.
const get = (request: APIRequestContext, path: string) => request.get(path, { maxRedirects: 0 });

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

test("staff pages send visitors without a session to sign-in, and are never stored", async ({ request }) => {
  const response = await get(request, "/staff/people");

  expect(response.status()).toBe(307);
  expect(new URL(response.headers()["location"] ?? "", "http://host").pathname).toBe("/staff/sign-in");
  expect(response.headers()["cache-control"] ?? "").toMatch(/(^|,)\s*no-store\s*(,|$)/i);
});

test("staff sign-in is never stored", async ({ request }) => {
  const response = await get(request, "/staff/sign-in");

  expect(response.status()).toBe(200);
  const directives = (response.headers()["cache-control"] ?? "")
    .split(",")
    .map((directive) => directive.trim().toLowerCase());
  expect(directives).toContain("no-store");
});
