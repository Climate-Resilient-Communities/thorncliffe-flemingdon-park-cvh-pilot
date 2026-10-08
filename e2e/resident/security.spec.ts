import { expect, test, type Page } from "@playwright/test";
import { newServer, stubDirectory } from "./directory-fixture";
import { stubMap } from "./map-fixture";

// SIT of 2026-10-08, finding F3: every page carries a Content-Security-Policy and the other security headers, and the policy
// blocks nothing the app itself loads: Next's inline scripts and styles, the self-hosted fonts, the map's tiles (fetched from the
// tile provider and drawn from blob URLs) and the service worker. A violation is caught twice: the page's own
// `securitypolicyviolation` event, and the console line the browser writes.

/** Starts recording the page's CSP violations, before any of its scripts runs. */
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

const RESIDENT_PAGES = ["/en", "/ur", "/en/ready", "/en/ready/numbers", "/en/directory", "/en/search", "/en/alerts", "/en/archive", "/en/text-alerts", "/en/choices", "/en/welcome", "/en/offline", "/en/buildings/4154146"];

test("every resident page answers with the security headers and loads without a policy violation", async ({ page }) => {
  await stubDirectory(page, newServer(7));
  const violations = await recordViolations(page);
  for (const path of RESIDENT_PAGES) {
    const response = await page.goto(path);
    const headers = response!.headers();
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(headers["x-powered-by"], path).toBeUndefined();
    expect(headers["x-robots-tag"], path).toBeUndefined();
    await page.waitForLoadState("networkidle");
    expect(await violations(), path).toEqual([]);
  }
});

test("the map draws its tiles from the tile provider, kept on the phone as blobs, without a policy violation", async ({ page }) => {
  const server = await stubMap(page);
  const violations = await recordViolations(page);
  await page.goto("/en/map");
  await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-status", "ready");
  await expect.poll(() => page.locator(".leaflet-tile-loaded").count()).toBeGreaterThan(0);
  expect(server.tileRequests.length).toBeGreaterThan(0);
  expect(await violations()).toEqual([]);
});

test.describe("with the service worker", () => {
  test.use({ serviceWorkers: "allow" });

  test("the service worker installs and takes over the page under the policy", async ({ page }) => {
    await stubDirectory(page, newServer(7));
    const violations = await recordViolations(page);
    await page.goto("/en");
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout: 30_000 });
    await page.goto("/en/ready/numbers");
    expect(await violations()).toEqual([]);
  });
});

test("a subscription page keeps sending no referrer: the address holds the token", async ({ request }) => {
  const response = await request.get("/en/subscription/edit", { maxRedirects: 0 });
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("robots.txt lets search engines read the resident pages, not the staff surface or the API", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toMatch(/User-Agent: \*/i);
  expect(body).toMatch(/^Allow: \/$/m);
  expect(body).toMatch(/^Disallow: \/staff$/m);
  expect(body).toMatch(/^Disallow: \/api\/$/m);
});

test("the API is marked noindex and carries the same headers", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-powered-by"]).toBeUndefined();
});
