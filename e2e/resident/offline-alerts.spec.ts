import { expect, test, type Page } from "@playwright/test";
import { ALERTS_URL } from "./alerts-server";

// S02.12 with S04.08, S05.03: what the offline copy does with alerts. An alert page must show the state the feed shows within 15 seconds, so a kept
// copy of one is never the page the resident reads while there is signal; without signal (or when the network is too slow) the kept copy is
// shown only with the note that says how old it is, and the home feed's alerts only as "last loaded". Runs against the alerts server, with the
// service worker allowed (every other resident test blocks it).
test.use({
  baseURL: ALERTS_URL,
  serviceWorkers: "allow",
  storageState: { cookies: [], origins: [{ origin: ALERTS_URL, localStorage: [{ name: "cvh.choices", value: JSON.stringify({ v: 1, welcomed: true }) }] }] },
});

const OPEN = "kbcdfghj";
const OPEN_TEXT = "Update: a technician is on site and the elevator should be working again by 6 pm.";
const RESOLVED = "rslvdabc";
const NEVER_OPENED = "mnpqrstv";

/** Waits until the service worker controls the page and has stored what it stores when it installs. */
async function workerReady(page: Page, lang = "en") {
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout: 30_000 });
  await expect.poll(() => isKept(page, `/${lang}/ready/numbers`), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => isKept(page, `/${lang}/offline`), { timeout: 30_000 }).toBe(true);
}

const isKept = (page: Page, path: string) => page.evaluate(async (p) => (await caches.match(`${location.origin}${p}`)) !== undefined, path);

/** The phone's signal, for the page and the service worker (as in offline.spec.ts). */
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

test("an alert read with signal is the server's page, with no note; without signal its kept copy comes with the note and since when", async ({ page }) => {
  const phone = await signal(page);
  await page.goto("/en");
  await workerReady(page);

  await page.goto(`/en/alerts/${OPEN}`);
  await page.reload();
  await expect(page.getByTestId("alert-article")).toContainText(OPEN_TEXT);
  await expect(page.getByTestId("offline-note")).toHaveCount(0);
  await page.goto(`/en/alerts/${RESOLVED}`);
  await expect(page.getByTestId("alert-closed")).toBeVisible();
  await expect.poll(() => isKept(page, `/en/alerts/${OPEN}`)).toBe(true);
  await expect.poll(() => isKept(page, `/en/alerts/${RESOLVED}`)).toBe(true);

  await phone.off();

  await page.goto(`/en/alerts/${OPEN}`);
  await expect(page.getByTestId("alert-article")).toContainText(OPEN_TEXT);
  await expect(page.getByTestId("offline-note")).toContainText("You are offline. Showing what was last loaded");

  // A closed alert's kept copy says it is closed, and carries the note too.
  await page.goto(`/en/alerts/${RESOLVED}`);
  await expect(page.getByTestId("alert-closed")).toBeVisible();
  await expect(page.getByTestId("offline-note")).toContainText("You are offline. Showing what was last loaded");

  // An alert this phone never opened is not guessed from another: the offline page, with the numbers.
  await page.goto(`/en/alerts/${NEVER_OPENED}`);
  await expect(page.getByTestId("offline-page")).toBeVisible();
  await expect(page.getByTestId("alert-article")).toHaveCount(0);
  await expect(page.locator('[data-component="not-911"]')).toBeVisible();
});

test("signal back: the alert page is the server's again, with no note", async ({ page }) => {
  const phone = await signal(page);
  await page.goto("/en");
  await workerReady(page);
  await page.goto(`/en/alerts/${OPEN}`);
  await page.reload();
  await expect.poll(() => isKept(page, `/en/alerts/${OPEN}`)).toBe(true);

  await phone.off();
  await page.goto(`/en/alerts/${OPEN}`);
  await expect(page.getByTestId("offline-note")).toBeVisible();

  await phone.on();
  await page.goto(`/en/alerts/${OPEN}`);
  await expect(page.getByTestId("alert-article")).toContainText(OPEN_TEXT);
  await expect(page.getByTestId("offline-note")).toHaveCount(0);
});

test("home without signal: the alerts of the feed kept on the phone are shown as last loaded, never as current", async ({ page }) => {
  const phone = await signal(page);
  await page.goto("/en");
  await workerReady(page);
  await page.reload();
  await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");
  await expect(page.getByTestId("feed-failed")).toHaveCount(0);
  await expect(page.getByTestId("home-alerts")).toBeVisible();

  await phone.off();
  await page.goto("/en");
  await expect(page.getByTestId("offline-note")).toBeVisible();
  await expect(page.getByTestId("feed-failed")).toBeVisible();
  await expect(page.getByTestId("feed-last-loaded")).toBeVisible();
  await expect(page.getByTestId("home-alerts")).toBeVisible();
});

test("a kept alert shown because the server is too slow, with signal, still carries the note and since when", async ({ page }) => {
  await page.goto("/en");
  await workerReady(page);
  await page.goto(`/en/alerts/${OPEN}`);
  await page.reload();
  await expect.poll(() => isKept(page, `/en/alerts/${OPEN}`)).toBe(true);

  // The phone has signal (navigator.onLine stays true) but the server takes longer than the worker waits (6 s).
  await page.context().route(`**/en/alerts/${OPEN}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 9_000));
    await route.fallback();
  });
  await page.goto(`/en/alerts/${OPEN}`, { timeout: 30_000 });
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(page.getByTestId("alert-article")).toContainText(OPEN_TEXT);
  await expect(page.getByTestId("offline-note")).toContainText("You are offline. Showing what was last loaded");
});

// S05.08 with S02.12: the share screen is a resident page like the alert it belongs to, so its kept copy is handed out only without signal (or too slowly) and
// with the note; and the share link's landing, /a/{slug}, is not one of the pages the worker keeps (its content follows `?l=`, which a kept copy would lose).
test("the share screen of a kept alert is kept like the alert, shows the note without signal, and the share link's landing is never kept", async ({ page }) => {
  const phone = await signal(page);
  await page.goto("/en");
  await workerReady(page);

  await page.goto(`/en/alerts/${OPEN}/share`);
  await page.reload();
  await expect(page.getByTestId("share-screen")).toBeVisible();
  await expect(page.getByTestId("offline-note")).toHaveCount(0);
  await expect.poll(() => isKept(page, `/en/alerts/${OPEN}/share`)).toBe(true);

  await page.goto(`/a/${OPEN}?l=en`);
  await expect(page.getByTestId("alert-article")).toBeVisible();
  expect(await isKept(page, `/a/${OPEN}`)).toBe(false);

  await phone.off();
  await page.goto(`/en/alerts/${OPEN}/share`);
  await expect(page.getByTestId("share-screen")).toBeVisible();
  await expect(page.getByTestId("offline-note")).toContainText("You are offline. Showing what was last loaded");
});
