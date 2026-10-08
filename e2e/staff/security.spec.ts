// SIT of 2026-10-08, finding F3: the staff surface carries the Content-Security-Policy and the other security headers, is never
// indexed, and works under the policy: sign-in, the password step and the Hub raise no policy violation.
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { openDatabase, signInToTheHub } from "./helpers";

let sql: postgres.Sql;

test.beforeAll(async () => {
  sql = openDatabase();
  await sql`delete from sign_in_failure`;
  await sql`delete from sign_in_lock`;
});

test.afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

/** Starts recording the page's CSP violations (its own event, and the browser's console line), before any of its scripts runs. */
async function recordViolations(page: Page): Promise<() => Promise<string[]>> {
  const logged: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) logged.push(message.text());
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = seen;
    document.addEventListener("securitypolicyviolation", (event) => seen.push(`${event.effectiveDirective} ${event.blockedURI}`));
  });
  return async () => [...logged, ...(await page.evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? []))];
}

test("staff sign-in answers with the security headers, noindex and no-store", async ({ request }) => {
  const response = await request.get("/staff/sign-in", { maxRedirects: 0 });
  const headers = response.headers();
  expect(response.status()).toBe(200);
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("signing in, choosing a password and opening the Hub raise no policy violation", async ({ page }) => {
  const violations = await recordViolations(page);
  await signInToTheHub(page, sql, "Csp", "Tester");
  await page.waitForLoadState("networkidle");
  expect(await violations()).toEqual([]);
});
