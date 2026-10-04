import { expect, type Page, type Request, type Route } from "@playwright/test";
import { USAGE_BODY_MAX_BYTES, USAGE_EVENTS, UsageEventSchema, type UsageEvent } from "../../src/contracts/usage";

// Usage events in the resident tests (S02.15). The resident servers have no database, so the real /api/metrics answers 503 there; the tests
// that count events answer it here. Every event any test sees is checked against the fixed message: {evt, lang, nbhd?}, a POST with no
// cookie, no referrer, no query and a body under 256 bytes. The specs that list "the only requests the app makes" set these aside with
// isUsageRequest and check them with expectUsageRequest, so they stay proofs that nothing else leaves the phone.

export const isUsageRequest = (url: string) => new URL(url).pathname === "/api/metrics";

export type SeenRequest = { method: string; url: string; headers: string; body: string };

/** One request to /api/metrics, checked against the fixed message; returns the event. */
export function expectUsageRequest(request: SeenRequest): UsageEvent {
  expect(request.method, request.url).toBe("POST");
  expect(new URL(request.url).search, request.url).toBe("");
  const headers = JSON.parse(request.headers) as Record<string, string>;
  expect(headers, request.url).not.toHaveProperty("cookie");
  expect(headers, request.url).not.toHaveProperty("authorization");
  // The page's address could name a building: the event goes with no referrer at all.
  expect(headers, request.url).not.toHaveProperty("referer");
  expect(new TextEncoder().encode(request.body).byteLength, request.body).toBeLessThanOrEqual(USAGE_BODY_MAX_BYTES);
  const raw = JSON.parse(request.body) as Record<string, unknown>;
  expect(Object.keys(raw).every((key) => ["evt", "lang", "nbhd"].includes(key)), request.body).toBe(true);
  const parsed = UsageEventSchema.safeParse(raw);
  expect(parsed.success, request.body).toBe(true);
  return parsed.data as UsageEvent;
}

/**
 * What a request carried. `allHeaders()` waits for the browser's second report of the request (the headers it added on the wire, the cookie
 * among them), which never comes for every request: the service worker's own script fetch (/serwist/sw.js, made again by the browser's update
 * check) may never get one, and awaiting it then hangs until the test times out. A usage request always reaches the network, so it is read
 * with `allHeaders()` (the check that it has no cookie needs the wire headers); any other request is read with `headers()`, which is
 * answered at once and holds everything the page or worker set, which is what the tests that look for the saved selection search.
 */
export async function seenRequest(request: Request): Promise<SeenRequest> {
  const headers = isUsageRequest(request.url()) ? await request.allHeaders() : request.headers();
  return { method: request.method(), url: request.url(), headers: JSON.stringify(headers), body: request.postData() ?? "" };
}

/** Answers /api/metrics with 204 and keeps what was sent, as the events counted. */
export async function stubMetrics(page: Page): Promise<{ events: UsageEvent[]; requests: SeenRequest[] }> {
  const seen = { events: [] as UsageEvent[], requests: [] as SeenRequest[] };
  await page.context().route("**/api/metrics", async (route: Route) => {
    const request = await seenRequest(route.request());
    seen.requests.push(request);
    seen.events.push(expectUsageRequest(request));
    await route.fulfill({ status: 204, headers: { "Cache-Control": "no-store" } });
  });
  return seen;
}

export { USAGE_EVENTS };
