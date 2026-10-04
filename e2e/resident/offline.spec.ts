import { expect, test, type Page } from "@playwright/test";
import { newServer, stubDirectory } from "./directory-fixture";
import { FEED_URL, feedOf } from "./home-fixture";
import { stubMap, TILE_URL } from "./map-fixture";
import { BUILDINGS, FLOOR } from "./choices-fixture";
import { expectUsageRequest, isUsageRequest, seenRequest, type SeenRequest } from "./usage-fixture";

// S02.12: the resident installs the CVH and reads it without signal. These tests run with the service worker, against the
// production build (the worker is registered only there). Every other resident test blocks it (playwright.resident.config.ts).
test.use({ serviceWorkers: "allow" });

/** Waits until the service worker controls the page and has stored what it stores when it installs. */
async function workerReady(page: Page, lang = "en") {
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout: 30_000 });
  await expect.poll(() => isKept(page, `/${lang}/ready/numbers`), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => isKept(page, `/${lang}/offline`), { timeout: 30_000 }).toBe(true);
}

/** Whether the service worker keeps a copy of the page at `path`. */
const isKept = (page: Page, path: string) => page.evaluate(async (p) => (await caches.match(`${location.origin}${p}`)) !== undefined, path);

/** Every URL in every cache of the origin, as "cache: url". */
const everything = (page: Page) =>
  page.evaluate(async () => {
    const all: string[] = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) all.push(`${name}: ${request.url}`);
    return all;
  });

/**
 * The phone's signal, for the page and the service worker. Playwright fulfils a stubbed route even while the context is
 * offline, so while there is no signal every request is refused here first; with signal it goes on to the stubs. Call it
 * after the stubs: the route registered last runs first.
 */
async function signal(page: Page) {
  let off = false;
  await page.context().route("**/*", (route) => (off ? route.abort("internetdisconnected") : route.fallback()));
  return {
    off: async () => {
      off = true;
      await page.context().setOffline(true);
    },
    on: async () => {
      off = false;
      await page.context().setOffline(false);
    },
  };
}

async function stubFeed(page: Page, version = 3) {
  await page.context().route(FEED_URL, (route) => route.fulfill({ json: feedOf(version), headers: { "Cache-Control": "no-store" } }));
}

test("the CVH is installable: each language links a valid manifest with the Hub's icons, opening on its home", async ({ page, request }) => {
  await page.goto("/ur");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/ur/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /\/icons\/apple-touch-icon\.png/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", /^#[0-9a-f]{6}$/);

  const response = await request.get("/ur/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = await response.json();
  expect(manifest).toMatchObject({ id: "/", start_url: "/ur", scope: "/", display: "standalone", dir: "rtl", lang: "ur" });
  expect(manifest.name.length).toBeGreaterThan(0);
  for (const icon of manifest.icons as { src: string; sizes: string }[]) {
    const image = await request.get(icon.src);
    expect(image.ok(), icon.src).toBe(true);
    expect(image.headers()["content-type"]).toBe("image/png");
  }
  expect((manifest.icons as { sizes: string }[]).map((icon) => icon.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));

  // The service worker that makes it work without signal is served for the whole origin.
  const worker = await request.get("/serwist/sw.js");
  expect(worker.ok()).toBe(true);
  expect(worker.headers()["service-worker-allowed"]).toBe("/");
});

test("after one visit with signal, home, the numbers, an opened guide and the directory open without signal", async ({ page }) => {
  await stubDirectory(page, newServer(7));
  await stubFeed(page);
  const phone = await signal(page);
  await page.goto("/en");
  await workerReady(page);
  // The first load ran before the worker took over; this one's feed goes through it and is kept.
  await page.reload();
  await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");
  await expect(page.getByTestId("offline-note")).toHaveCount(0);

  await page.goto("/en/ready/heat");
  await expect(page.getByTestId("guide-page")).toBeVisible();
  await page.goto("/en/directory");
  await expect(page.getByTestId("directory-list")).toBeVisible();
  // The guide was opened by a link inside the app as well as loaded: either way it is kept.
  await expect.poll(() => isKept(page, "/en/ready/heat")).toBe(true);
  await expect.poll(() => isKept(page, "/en/directory")).toBe(true);

  await phone.off();

  await page.goto("/en/ready/numbers");
  await expect(page.getByTestId("numbers-page")).toBeVisible();
  await expect(page.getByTestId("numbers-911")).toBeVisible();
  await expect(page.locator('[data-component="not-911"]')).toBeVisible();
  await expect(page.getByTestId("offline-note")).toContainText("You are offline. Showing what was last loaded");

  await page.goto("/en/ready/heat");
  await expect(page.getByTestId("offline-note")).toBeVisible();
  await expect(page.locator("h1")).toBeVisible();

  await page.goto("/en/directory");
  await expect(page.getByTestId("directory-list")).toBeVisible();
  await expect(page.getByTestId("directory-last-updated")).toContainText("Last updated");
  await expect(page.getByTestId("offline-note")).toBeVisible();

  // Home: the feed is shown as what was last loaded, never as current.
  await page.goto("/en");
  await expect(page.getByTestId("offline-note")).toBeVisible();
  await expect(page.getByTestId("feed-failed")).toBeVisible();
  await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");
  await expect(page.getByTestId("feed-last-loaded")).toBeVisible();
});

test("a page never loaded opens the offline page, with the numbers and what can be read without signal", async ({ page }) => {
  await stubFeed(page);
  const phone = await signal(page);
  await page.goto("/en");
  await workerReady(page);
  await phone.off();

  await page.goto("/en/terms");
  await expect(page.getByTestId("offline-page")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page is not saved on your phone");
  await expect(page.locator('[data-component="not-911"]')).toBeVisible();
  await expect(page.getByTestId("offline-hub")).toHaveAttribute("href", /^tel:\+1\d{10}$/);
  await expect(page.getByTestId("kept-/en/ready/numbers")).toBeVisible();
  await expect(page.getByTestId("kept-/en")).toBeVisible();
  await expect(page.getByTestId("kept-/en/offline")).toHaveCount(0);

  await page.getByTestId("offline-numbers").click();
  await expect(page).toHaveURL(/\/en\/ready\/numbers$/);
  await expect(page.getByTestId("numbers-page")).toBeVisible();
});

test("signal back: the feed is asked at once and the note goes", async ({ page }) => {
  let asked = 0;
  await page.context().route(FEED_URL, (route) => {
    asked += 1;
    return route.fulfill({ json: feedOf(3 + asked), headers: { "Cache-Control": "no-store" } });
  });
  const phone = await signal(page);
  await page.goto("/en");
  await workerReady(page);
  await phone.off();
  await page.goto("/en");
  await expect(page.getByTestId("feed-failed")).toBeVisible();
  await expect(page.getByTestId("offline-note")).toBeVisible();
  const before = asked;
  await phone.on();
  await expect.poll(() => asked).toBeGreaterThan(before);
  await expect(page.getByTestId("feed-failed")).toHaveCount(0);
  await expect(page.getByTestId("offline-note")).toHaveCount(0);
});

test("map tiles are kept by the map page only, never by the service worker", async ({ page }) => {
  await stubMap(page);
  await page.goto("/en");
  await workerReady(page);
  await page.goto("/en/map");
  await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await everything(page)).filter((entry) => TILE_URL.test(entry.split(": ")[1])).length).toBeGreaterThan(0);

  const tiles = (await everything(page)).filter((entry) => TILE_URL.test(entry.split(": ")[1]));
  // Every tile copy is in the map's own cache; none in any cache of the service worker.
  expect(tiles.every((entry) => entry.startsWith("cvh-map-tiles-v1: "))).toBe(true);
  const elsewhere = (await everything(page)).filter((entry) => !entry.startsWith("cvh-map-tiles-v1: ") && /basemaps|tile/.test(entry));
  expect(elsewhere).toEqual([]);
});

test("nothing from the staff surface or its API is ever stored", async ({ page }) => {
  await stubFeed(page);
  await page.goto("/en");
  await workerReady(page);
  await page.goto("/staff/sign-in");
  await page.evaluate(async () => {
    await fetch("/api/staff/me").catch(() => undefined);
  });
  await page.goto("/en/ready");
  await expect.poll(() => isKept(page, "/en/ready")).toBe(true);
  const stored = await everything(page);
  expect(stored.length).toBeGreaterThan(0);
  expect(stored.filter((entry) => /\/staff(\/|$|\?)|\/api\/staff\//.test(entry.split(": ")[1]))).toEqual([]);
});

// S05.07: an alert read from a copy kept without signal is not shown as current once its valid-until has passed by the phone's clock adjusted by the last known
// server_now offset. These tests use the alerts server (fixtures/feed.json: server_now is 2026-10-01 15:00 UTC, kbcdfghj is valid until 22:00 and mnpqrstv until
// the next day) and move the phone's own clock forward eight hours, which by the offset is 23:00 on the server's clock: kbcdfghj has passed, mnpqrstv has not.
test.describe("an alert read without signal after its time (S05.07)", () => {
  const ALERTS = `http://localhost:${process.env.E2E_ALERTS_PORT ?? String(Number(process.env.E2E_PORT ?? "3000") + 500)}`;
  test.use({ baseURL: ALERTS, storageState: { cookies: [], origins: [{ origin: ALERTS, localStorage: [{ name: "cvh.choices", value: JSON.stringify({ v: 1, welcomed: true }) }] }] } });
  const NOTE = "This alert may have ended. Check again when you have signal";
  const EIGHT_HOURS = 8 * 3_600_000;

  test("the alert page says it may have ended instead of its valid-until, only from a copy kept without signal", async ({ page }) => {
    const phone = await signal(page);
    await page.goto("/en/alerts/kbcdfghj");
    await workerReady(page);
    await page.reload();
    await expect(page.getByTestId("alert-valid")).toBeVisible();
    await expect(page.getByTestId("alert-may-have-ended")).toHaveCount(0);
    await expect.poll(() => isKept(page, "/en/alerts/kbcdfghj")).toBe(true);

    await phone.off();
    await page.clock.install({ time: new Date(Date.now() + EIGHT_HOURS) });
    await page.reload();

    await expect(page.getByTestId("offline-note")).toBeVisible();
    await expect(page.getByTestId("alert-may-have-ended")).toHaveText(NOTE);
    await expect(page.getByTestId("alert-valid")).toHaveCount(0);
    await expect(page.getByTestId("alert-text")).toBeVisible();

    // With signal the server's own page is shown, whatever the phone's clock says: no note.
    await phone.on();
    await page.reload();
    await expect(page.getByTestId("alert-may-have-ended")).toHaveCount(0);
    await expect(page.getByTestId("alert-valid")).toBeVisible();
  });

  test("signal back after opening from a kept home copy: an alert opened by a move inside the app is the server's page, never 'may have ended'", async ({ page }) => {
    const phone = await signal(page);
    await page.goto("/en");
    await workerReady(page);
    await page.reload();
    await expect(page.getByTestId("alert-card-kbcdfghj")).toBeVisible();

    await phone.off();
    await page.clock.install({ time: new Date(Date.now() + EIGHT_HOURS) });
    await page.reload();
    await expect(page.getByTestId("feed-failed")).toBeVisible();

    // Signal is back: the head still carries the kept copy's marker, but the page we move to comes from the server.
    await phone.on();
    await page.getByTestId("alert-card-kbcdfghj").click();
    await expect(page.getByTestId("alert-valid")).toBeVisible();
    await expect(page.getByTestId("alert-may-have-ended")).toHaveCount(0);
  });

  test("a card on home says it may have ended when the kept feed is read after its time, and the others stay as they were", async ({ page }) => {
    const phone = await signal(page);
    await page.goto("/en");
    await workerReady(page);
    await page.reload();
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");
    await expect(page.getByTestId("alert-card-kbcdfghj")).toBeVisible();
    await expect(page.locator('[data-testid^="alert-card-ended-"]')).toHaveCount(0);

    await phone.off();
    await page.clock.install({ time: new Date(Date.now() + EIGHT_HOURS) });
    await page.reload();

    await expect(page.getByTestId("feed-failed")).toBeVisible();
    const ended = page.getByTestId("alert-card-ended-kbcdfghj");
    await expect(ended).toHaveText(NOTE);
    await expect(page.getByTestId("alert-card-kbcdfghj")).toHaveAttribute("class", /alert-card--ended/);
    await expect(page.getByTestId("alert-card-ended-mnpqrstv")).toHaveCount(0);
    await expect(page.getByTestId("alert-card-mnpqrstv")).toContainText("Posted");
    // It is still a link to the alert, which opens from the kept copy.
    await expect(page.getByTestId("alert-card-kbcdfghj")).toHaveAttribute("href", "/en/alerts/kbcdfghj");
  });
});

// S02.15: with the worker in charge, a usage event is a POST, which the worker leaves to the network: it is never answered from a cache, never kept, and (as in
// every other test) no request carries the saved selection. Without signal the event is dropped and nothing is sent when the signal comes back.
test("usage events pass the worker untouched: not kept, not queued, and no request carries the saved selection", async ({ page, context }) => {
  const saved = { v: 1, lang: "en", welcomed: true, groups: ["seniors"], buildings: [BUILDINGS[0].rsn], floors: [FLOOR.milepost2], muted: ["zz-muted-topic"], basic: true };
  await page.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem(key, value);
    }
  }, ["cvh.choices", JSON.stringify(saved)]);
  const pending: Promise<SeenRequest>[] = [];
  context.on("request", (request) => pending.push(seenRequest(request)));
  await page.goto("/en/ready/numbers");
  await workerReady(page);
  // A page opened with the worker in charge: its view is sent through the worker to the network.
  await page.goto("/en/ready/power");
  await page.waitForLoadState("networkidle");

  expect((await everything(page)).filter((entry) => entry.includes("/api/metrics"))).toEqual([]);
  const offline = await signal(page);
  const before = (await Promise.all(pending)).filter((request) => isUsageRequest(request.url)).length;
  await offline.off();
  await page.goto("/en/ready/numbers");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(500);
  await offline.on();
  await page.waitForTimeout(500);

  const all = await Promise.all(pending);
  const sent = all.filter((request) => isUsageRequest(request.url));
  expect(sent.length).toBe(before);
  expect(before).toBeGreaterThanOrEqual(2);
  for (const request of sent) expectUsageRequest(request);
  for (const request of all) {
    for (const secret of [BUILDINGS[0].rsn, FLOOR.milepost2, "seniors", "zz-muted-topic", "cvh.choices"]) {
      expect(`${request.url}\n${request.headers}\n${request.body}`, `${request.url} carries ${secret}`).not.toContain(secret);
    }
  }
});
