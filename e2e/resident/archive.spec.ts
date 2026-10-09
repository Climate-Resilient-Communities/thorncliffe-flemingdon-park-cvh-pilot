import { expect, test, type Page } from "@playwright/test";
import { ARCHIVE_PAGE_SIZE, ArchiveV1 } from "../../src/contracts/feed";
import { LAUNCH_LANGUAGES } from "../../src/i18n/languages";
import { ALERTS_URL } from "./alerts-server";
import { catalogText, expectBaseline, openResident } from "./helpers";

// S05.07: the archive (R-08) and /api/feed/archive, against the production build with the threads of fixtures/feed.json (the second server of
// playwright.resident.config.ts). The feed's clock is fixed in that file (2026-10-01 15:00 UTC), so every "ago" reads the same every day. Closed there:
//   wthdrabc  power: withdrawn at 14:00, the acknowledgement withdrawn with a reason
//   rslvdabc  power: resolved at 13:00, with its final message
//   expdabcd  other: expired at 08:00
//   older01ended .. older18ended  power: expired on 28 to 30 September, so the archive has 21 threads: a page of 20, and one more
// The open threads of that file are never in the archive. The first server has no alerts at all: its archive is empty.

const PLAIN_URL = `http://localhost:${process.env.E2E_PORT ?? "3000"}`;
const welcomed = (origin: string) => ({ cookies: [], origins: [{ origin, localStorage: [{ name: "cvh.choices", value: JSON.stringify({ v: 1, welcomed: true }) }] }] });

test.use({ baseURL: ALERTS_URL, storageState: welcomed(ALERTS_URL) });

const WITHDRAWN = "wthdrabc";
const RESOLVED = "rslvdabc";
const EXPIRED = "expdabcd";
const OLDEST = "older18ended";
const FINAL = "Power is back on all floors. If your power is still out, call Toronto Hydro at 416-542-8000.";
const WITHDRAWAL_REASON = "This alert had wrong information. It has been withdrawn.";
const EXPIRED_TEXT = "A water main near 5 Gamma Ave is being repaired. Water pressure may be low until noon.";
const OPEN = ["kbcdfghj", "mnpqrstv", "xyzw2345", "qrstvwxz"];

const noCookie = (response: { headersArray(): { name: string }[] }) => response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie");
const overflow = (page: Page) => page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: document.querySelector("main")!.scrollWidth - document.querySelector("main")!.clientWidth }));

/** The tap rule: every visible link, button and disclosure summary of the main area is at least --tap-current in both dimensions. */
const tapViolations = (page: Page) =>
  page.evaluate(() => {
    const minimum = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tap-current"));
    return [...document.querySelectorAll<HTMLElement>("main a[href], main button, main summary")]
      .filter((element) => element.checkVisibility())
      .filter((element) => {
        const { width, height } = element.getBoundingClientRect();
        return width < minimum || height < minimum;
      })
      .map((element) => element.outerHTML.slice(0, 80));
  });

test.describe("/api/feed/archive", () => {
  test("lists the closed threads newest closed first, 20 to a page, as a valid ArchiveV1, with no cookie and at most 60 seconds at the edge", async ({ request }) => {
    const response = await request.get("/api/feed/archive?lang=en", { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(noCookie(response)).toEqual([]);
    expect(response.headers()["cache-control"]).toBe("public, max-age=0, s-maxage=60");
    const archive = ArchiveV1.parse(await response.json());
    expect(archive).toMatchObject({ v: 1, page: 1, has_more: true, server_now: "2026-10-01T15:00:00.000Z" });
    expect(archive.threads).toHaveLength(ARCHIVE_PAGE_SIZE);
    expect(archive.threads.slice(0, 4).map((thread) => [thread.slug, thread.close_reason, thread.closed_at])).toEqual([
      [WITHDRAWN, "withdrawn", "2026-10-01T14:00:00.000Z"],
      [RESOLVED, "resolved", "2026-10-01T13:00:00.000Z"],
      [EXPIRED, "expired", "2026-10-01T08:00:00.000Z"],
      ["older01ended", "expired", "2026-09-30T20:00:00.000Z"],
    ]);
    const times = archive.threads.map((thread) => Date.parse(thread.closed_at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    for (const slug of OPEN) expect(archive.threads.map((thread) => thread.slug)).not.toContain(slug);
  });

  test("gives every entry of a thread as it is shown when live: the resolved thread's three, the withdrawn one's notice and the entry it withdrew", async ({ request }) => {
    const archive = ArchiveV1.parse(await (await request.get("/api/feed/archive?lang=en")).json());

    const resolved = archive.threads.find((thread) => thread.slug === RESOLVED)!;
    expect(resolved.entries.map((entry) => entry.kind)).toEqual(["ack", "update", "final"]);
    expect(resolved.entries.at(-1)!.original.body).toBe(FINAL);
    const withdrawn = archive.threads.find((thread) => thread.slug === WITHDRAWN)!;
    expect(withdrawn.entries.map((entry) => [entry.kind, entry.supersedes_id === undefined ? null : "names its target"])).toEqual([
      ["ack", null],
      ["withdrawal", "names its target"],
    ]);
    // The same entries the thread's own page reads (the closed thread at its address).
    const alone = await (await request.get(`/en/alerts/${RESOLVED}`)).text();
    expect(alone).toContain(FINAL);
  });

  test("serves the next page, then an empty one past the last, in the language asked for", async ({ request }) => {
    const second = ArchiveV1.parse(await (await request.get("/api/feed/archive?lang=ur&page=2")).json());

    expect(second).toMatchObject({ page: 2, has_more: false });
    expect(second.threads.map((thread) => thread.slug)).toEqual([OLDEST]);
    expect(second.threads[0].entries[0].text).toMatchObject({ lang: "ur", status: "fallback_en" });
    const third = ArchiveV1.parse(await (await request.get("/api/feed/archive?lang=en&page=3")).json());
    expect(third).toMatchObject({ page: 3, has_more: false, threads: [] });
  });

  test("sets no cookie in any language, and refuses a bad language, page or parameter with no caching", async ({ request }) => {
    for (const { code } of LAUNCH_LANGUAGES) {
      const response = await request.get(`/api/feed/archive?lang=${code}`, { maxRedirects: 0 });
      expect(response.status(), code).toBe(200);
      expect(noCookie(response), code).toEqual([]);
    }
    for (const path of ["/api/feed/archive", "/api/feed/archive?lang=xx", "/api/feed/archive?lang=en&page=0", "/api/feed/archive?lang=en&page=abc", "/api/feed/archive?lang=en&building=4154146"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(400);
      expect(response.headers()["cache-control"], path).toBe("no-store");
      expect(noCookie(response), path).toEqual([]);
    }
  });
});

test.describe("the archive screen (R-08)", () => {
  test("shows the alerts that have ended, newest ended first, each with how and when it ended, its words, who sent it and when it was posted", async ({ page }) => {
    const response = await openResident(page, "/en/archive", 390);

    expect(response!.status()).toBe(200);
    await expect(page.getByTestId("archive-title")).toHaveText(catalogText("en", "R08.title"));
    const cards = page.getByTestId("archive-list").locator("li");
    await expect(cards).toHaveCount(ARCHIVE_PAGE_SIZE);
    // The ones that end in a different way each have their own words and mark.
    const withdrawn = page.getByTestId(`archive-card-${WITHDRAWN}`);
    await expect(withdrawn).toHaveAttribute("data-reason", "withdrawn");
    await expect(page.getByTestId(`archive-end-${WITHDRAWN}`)).toHaveText("Withdrawn 1 hour ago");
    await expect(page.getByTestId(`archive-end-${WITHDRAWN}`).locator(".alert-ico--info")).toBeVisible();
    await expect(page.getByTestId(`archive-text-${WITHDRAWN}`)).toHaveText(WITHDRAWAL_REASON);
    const resolved = page.getByTestId(`archive-card-${RESOLVED}`);
    await expect(page.getByTestId(`archive-end-${RESOLVED}`)).toHaveText("Resolved 2 hours ago");
    await expect(page.getByTestId(`archive-end-${RESOLVED}`).locator(".alert-ico--check")).toBeVisible();
    await expect(page.getByTestId(`archive-text-${RESOLVED}`)).toHaveText(FINAL);
    await expect(resolved.getByTestId("alert-types")).toContainText("Power");
    await expect(resolved.getByTestId("alert-attribution")).toHaveText("Community alert from the Hub");
    await expect(resolved.getByTestId("alert-verification")).toHaveText("Verified by the Hub");
    await expect(page.getByTestId(`archive-posted-${RESOLVED}`)).toHaveText("Posted 4 hours ago");
    await expect(page.getByTestId(`archive-end-${EXPIRED}`)).toHaveText("Expired 7 hours ago");
    await expect(page.getByTestId(`archive-end-${EXPIRED}`).locator(".alert-ico--clock")).toBeVisible();
    await expect(page.getByTestId(`archive-text-${EXPIRED}`)).toHaveText(EXPIRED_TEXT);
    // Newest ended first.
    const slugs = await cards.evaluateAll((items) => items.map((item) => item.querySelector("a")!.getAttribute("href")!.split("/").at(-1)));
    expect(slugs.slice(0, 4)).toEqual([WITHDRAWN, RESOLVED, EXPIRED, "older01ended"]);
    // An open alert is not here, and the 911 notice is.
    for (const slug of OPEN) await expect(page.getByTestId(`archive-card-${slug}`)).toHaveCount(0);
    await expect(page.locator('[data-component="not-911"]')).toBeVisible();
  });

  test("opens each alert read-only at its own address, and back returns to the archive's home", async ({ page }) => {
    await openResident(page, "/en/archive", 390);
    await expect(page.getByTestId(`archive-card-${RESOLVED}`)).toHaveAttribute("href", `/en/alerts/${RESOLVED}`);

    await page.getByTestId(`archive-card-${RESOLVED}`).click();

    await expect(page).toHaveURL(new RegExp(`/en/alerts/${RESOLVED}$`));
    await expect(page.getByTestId("alert-closed")).toHaveAttribute("data-reason", "resolved");
    await expect(page.getByTestId("alert-text")).toHaveText(FINAL);
    await page.goBack();
    await page.getByTestId("archive-back").click();
    await expect(page).toHaveURL(/\/en$/);
  });

  test("asks for the next page when 'Show older alerts' is pressed, and shows no more once there is no more", async ({ page }) => {
    await openResident(page, "/en/archive", 390);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/feed/archive") requests.push(`${request.method()} ${new URL(request.url()).search} ${request.headers().cookie ?? ""}`);
    });
    await expect(page.getByTestId("archive-list").locator("li")).toHaveCount(ARCHIVE_PAGE_SIZE);
    await expect(page.getByTestId(`archive-card-${OLDEST}`)).toHaveCount(0);

    await page.getByTestId("archive-more").click();

    await expect(page.getByTestId("archive-list").locator("li")).toHaveCount(ARCHIVE_PAGE_SIZE + 1);
    await expect(page.getByTestId(`archive-card-${OLDEST}`)).toBeVisible();
    await expect(page.getByTestId("archive-more")).toHaveCount(0);
    // Only the page language and the page number are asked, nothing of the resident, and no cookie.
    expect(requests).toEqual(["GET ?lang=en&page=2 "]);
  });

  test("says it could not load older alerts when the next page fails, keeps what is shown and lets the resident try again", async ({ page }) => {
    await openResident(page, "/en/archive", 390);
    let failing = true;
    await page.route(/\/api\/feed\/archive\?lang=en&page=2$/, (route) => (failing ? route.fulfill({ status: 503, json: { error: { code: "FEED_UNAVAILABLE", message_key: "feed.unavailable" } } }) : route.fallback()));

    await page.getByTestId("archive-more").click();

    await expect(page.getByTestId("archive-more-failed")).toHaveText(catalogText("en", "R08.moreFailed"));
    await expect(page.getByTestId("archive-list").locator("li")).toHaveCount(ARCHIVE_PAGE_SIZE);
    failing = false;
    await page.getByTestId("archive-more").click();
    await expect(page.getByTestId("archive-list").locator("li")).toHaveCount(ARCHIVE_PAGE_SIZE + 1);
    await expect(page.getByTestId("archive-more-failed")).toHaveCount(0);
  });

  test("home links to it: 'Alerts that have ended'", async ({ page }) => {
    await openResident(page, "/en", 390);

    const link = page.getByTestId("home-archive");
    await expect(link).toHaveText(catalogText("en", "R03.archive"));
    await expect(link).toHaveAttribute("href", "/en/archive");
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await link.click();
    await expect(page).toHaveURL(/\/en\/archive$/);
    await expect(page.getByTestId("archive-title")).toBeVisible();
  });

  for (const [lang, width] of [["en", 390], ["en", 1280], ["ur", 390]] as const) {
    test(`${lang} archive at ${width}px has no horizontal scrolling, every link and button is a tap target and it matches its baseline screenshot`, async ({ page }) => {
      await openResident(page, `/${lang}/archive`, width, 900);

      expect(await overflow(page)).toEqual({ page: 0, main: 0 });
      expect(await tapViolations(page)).toEqual([]);
      await expectBaseline(page, `archive-${lang}-${width}.png`);
    });
  }

  test("opens in every language, lists the closed alerts and sets no cookie", async ({ request }) => {
    for (const { code } of LAUNCH_LANGUAGES) {
      const response = await request.get(`/${code}/archive`, { maxRedirects: 0 });
      expect(response.status(), code).toBe(200);
      expect(noCookie(response), code).toEqual([]);
      expect(await response.text(), code).toContain(RESOLVED);
    }
  });
});

test.describe("the archive screen with nothing to show", () => {
  test.use({ baseURL: PLAIN_URL, storageState: welcomed(PLAIN_URL) });

  test("says that no alert has ended yet and offers the way back to Alerts", async ({ page }) => {
    await openResident(page, "/en/archive", 390);

    await expect(page.getByTestId("archive-empty")).toContainText(catalogText("en", "R08.empty"));
    await expect(page.getByTestId("archive-empty")).toContainText(catalogText("en", "R08.emptyBody"));
    await expect(page.getByTestId("archive-list")).toHaveCount(0);
    await expect(page.getByTestId("archive-more")).toHaveCount(0);
    expect(await overflow(page)).toEqual({ page: 0, main: 0 });
    expect(await tapViolations(page)).toEqual([]);
    await expectBaseline(page, "archive-en-empty-390.png");
    await page.getByTestId("archive-home").click();
    await expect(page).toHaveURL(/\/en$/);
  });
});
