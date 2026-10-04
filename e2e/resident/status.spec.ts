import { expect, test, type Page } from "@playwright/test";
import { BUILDINGS, seedChoices, stubBuildingList } from "./choices-fixture";
import { closedThread, feedOf, stubArchive, stubFeed } from "./home-fixture";
import { catalogText, expectBaseline, openResident } from "./helpers";

// S05.06: a resident sees the status of each building and neighbourhood as text and icon as well as colour ("Active problem", "Work in progress", "Resolved",
// or "Nothing active"), "Not yet verified" when it rests only on unverified reports, and the links to the threads behind it, on home and on the building page.
// The status itself is derived on the server (src/modules/alerting/domain/status.ts, with its own unit and database tests); here the feed is answered with
// its places and threads, and the page is tested for what it shows of them.

const MILEPOST = BUILDINGS[0].rsn; // 4 Milepost Pl, Thorncliffe Park (the sample building 4154146 of fixtures/buildings.json)
const SLUG = "kbcdfghj";
// The building page reads the sample buildings of fixtures/buildings.json: this is its first one, in Thorncliffe Park.
const PAGE_RSN = "4154146";

/** A feed that lists the sample building of the page at the status given, besides the pilot buildings of the choices fixture. */
function pageFeed(status: "none" | "active" | "in_progress" | "resolved", verified = true) {
  const feed = feedOf(3);
  return { ...feed, places: { ...feed.places, buildings: [...feed.places.buildings, { rsn: PAGE_RSN, status, verified }] } };
}

const thread = (slug: string, types: string[], rsn: string = MILEPOST): Record<string, unknown> => ({
  id: `0198a000-0000-7000-8000-0000000005${slug.charCodeAt(0) % 90}`,
  slug,
  types,
  audience: { scope: "buildings", buildings: [{ rsn, floors: null }], groups: [], types },
  state: "open",
  valid_until: "2026-10-02T12:00:00.000Z",
  entries: [
    {
      id: `0198a000-0000-7000-8000-0000000006${slug.charCodeAt(0) % 90}`,
      kind: "ack",
      phase: "problem",
      verified: false,
      attribution: { role: "hub" },
      published_at: "2026-10-01T11:00:00.000Z",
      text: { lang: "en", body: "Power is out.", machine: false, model: null, status: "source", source_hash: "a".repeat(64) },
      original: { lang: "en", body: "Power is out." },
    },
  ],
});

const withThreads = (feed: ReturnType<typeof feedOf>, ...threads: Record<string, unknown>[]) => ({ ...feed, threads });
const choose = (page: Page) => seedChoices(page, JSON.stringify({ v: 1, lang: "en", welcomed: true, buildings: [MILEPOST] }));

test.beforeEach(async ({ page }) => {
  await stubBuildingList(page);
});

test.describe("the building page", () => {
  test("shows an active, unverified status as words, icon and 'Not yet verified', with a link to the thread behind it", async ({ page }) => {
    await stubFeed(page, [withThreads(pageFeed("active", false), thread(SLUG, ["power"], PAGE_RSN))]);

    await openResident(page, `/en/buildings/${PAGE_RSN}`, 390);

    const status = page.getByTestId("building-status");
    await expect(status.getByTestId("home-status")).toHaveText(catalogText("en", "status.active"));
    await expect(status.getByTestId("home-status")).toHaveAttribute("data-status", "active");
    await expect(status.getByTestId("home-unverified")).toHaveText(catalogText("en", "x02.notYetVerified"));
    const icon = await status.locator(".home-ico").first().evaluate((element) => ({ mask: getComputedStyle(element).maskImage || getComputedStyle(element).webkitMaskImage, width: getComputedStyle(element).width }));
    expect(icon.mask).toMatch(/^url\(/);
    expect(parseFloat(icon.width)).toBeGreaterThan(10);
    const link = status.getByTestId(`status-thread-${SLUG}`);
    await expect(link).toHaveText(catalogText("en", "x13.power"));
    await expect(link).toHaveAttribute("href", `/en/alerts/${SLUG}`);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("shows work in progress verified, with no 'Not yet verified'", async ({ page }) => {
    await stubFeed(page, [pageFeed("in_progress")]);

    await openResident(page, `/en/buildings/${PAGE_RSN}`, 390);

    await expect(page.getByTestId("building-status").getByTestId("home-status")).toHaveText(catalogText("en", "status.progress"));
    await expect(page.getByTestId("home-unverified")).toHaveCount(0);
  });

  test("shows a resolved status with its words and no thread link when the archive names no thread that covers the building (a closed thread is not in the feed)", async ({ page }) => {
    await stubFeed(page, [pageFeed("resolved")]);
    await stubArchive(page, [closedThread("mnpqrstv", "700000010")]);

    await openResident(page, `/en/buildings/${PAGE_RSN}`, 390);

    await expect(page.getByTestId("building-status").getByTestId("home-status")).toHaveText(catalogText("en", "status.resolved"));
    await expect(page.getByTestId("building-status-threads")).toHaveCount(0);
  });

  test("links a resolved status to the closed thread (R-07), found in the archive (S05.07)", async ({ page }) => {
    await stubFeed(page, [pageFeed("resolved")]);
    const archive = await stubArchive(page, [closedThread(SLUG, PAGE_RSN)]);

    await openResident(page, `/en/buildings/${PAGE_RSN}`, 390);

    const status = page.getByTestId("building-status");
    await expect(status.getByTestId("home-status")).toHaveText(catalogText("en", "status.resolved"));
    const link = status.getByTestId(`status-thread-${SLUG}`);
    await expect(link).toHaveText(catalogText("en", "x13.power"));
    await expect(link).toHaveAttribute("href", `/en/alerts/${SLUG}`);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // The archive is asked the way everyone asks: the page language and the first page, no body, no cookie, nothing of the resident.
    expect(archive.map((request) => new URL(request.url).search)).toEqual(["?lang=en&page=1"]);
    expect(archive[0].body).toBe("");
    expect(archive[0].headers.cookie).toBeUndefined();
  });

  test("names no closed thread once the 12 hours of the resolved status have passed by the archive's own clock, and no thread that expired or was withdrawn", async ({ page }) => {
    await stubFeed(page, [pageFeed("resolved")]);
    await stubArchive(page, [
      closedThread("aaaaaaaa", PAGE_RSN, { closed_at: "2026-09-30T23:59:00.000Z" }),
      closedThread("bbbbbbbb", PAGE_RSN, { close_reason: "expired" }),
      closedThread("cccccccc", PAGE_RSN, { close_reason: "withdrawn" }),
    ]);

    await openResident(page, `/en/buildings/${PAGE_RSN}`, 390);

    await expect(page.getByTestId("building-status").getByTestId("home-status")).toHaveText(catalogText("en", "status.resolved"));
    await expect(page.getByTestId("building-status-threads")).toHaveCount(0);
  });

  test("keeps the resolved status and says nothing is wrong when the archive cannot be read: only the link is missing", async ({ page }) => {
    await stubFeed(page, [pageFeed("resolved")]);
    const archive = await stubArchive(page, "unavailable");

    await openResident(page, `/en/buildings/${PAGE_RSN}`, 390);

    await expect(page.getByTestId("building-status").getByTestId("home-status")).toHaveText(catalogText("en", "status.resolved"));
    await expect.poll(() => archive.length).toBe(1);
    await expect(page.getByTestId("building-status-threads")).toHaveCount(0);
    await expect(page.getByTestId("feed-failed")).toHaveCount(0);
  });

  test("does not ask for the archive when no place is resolved", async ({ page }) => {
    await stubFeed(page, [pageFeed("active")]);
    const archive = await stubArchive(page, [closedThread(SLUG, PAGE_RSN)]);

    await openResident(page, `/en/buildings/${PAGE_RSN}`, 390);
    await expect(page.getByTestId("building-status").getByTestId("home-status")).toHaveText(catalogText("en", "status.active"));

    expect(archive).toEqual([]);
  });

  test("says Not known, never 'Nothing active', when the feed cannot be read", async ({ page }) => {
    await stubFeed(page, ["unavailable"]);

    await openResident(page, `/en/buildings/${PAGE_RSN}`, 390);

    await expect(page.getByTestId("building-status").getByTestId("home-status")).toHaveText(catalogText("en", "status.unknown"));
  });

  test("shows it in the page's language", async ({ page }) => {
    await stubFeed(page, [pageFeed("active")]);

    await openResident(page, `/fr/buildings/${PAGE_RSN}`, 390);

    await expect(page.getByTestId("building-status").getByTestId("home-status")).toHaveText(catalogText("fr", "status.active").replace("[EN] ", ""));
  });
});

for (const lang of ["en", "ur"] as const) {
  test(`${lang} building page with an active, unverified status and its thread has no horizontal scrolling and matches its baseline screenshot`, async ({ page }) => {
    await stubFeed(page, [withThreads(pageFeed("active", false), thread(SLUG, ["power"], PAGE_RSN))]);

    await openResident(page, `/${lang}/buildings/${PAGE_RSN}`, 390, 900);
    await expect(page.getByTestId(`status-thread-${SLUG}`)).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await expectBaseline(page, `building-status-${lang}-390.png`);
  });
}

test.describe("home", () => {
  test("links the threads behind a building's status beside its row, and a neighbourhood's beneath its row", async ({ page }) => {
    const neighbourhoodThread = { ...thread("mnpqrstv", ["water"]), audience: { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["water"] } };
    await stubFeed(page, [withThreads(feedOf(4, { buildings: { [MILEPOST]: { status: "active" } }, neighbourhoods: { TP: { status: "active" } } }), thread(SLUG, ["power"]), neighbourhoodThread)]);
    await choose(page);

    await openResident(page, "/en", 390);
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");

    const own = page.getByTestId(`home-building-threads-${MILEPOST}`);
    // Both threads cover the building: its own, and the neighbourhood's through the neighbourhood it is in.
    await expect(own.getByRole("link")).toHaveCount(2);
    await expect(own.getByTestId(`status-thread-${SLUG}`)).toHaveAttribute("href", `/en/alerts/${SLUG}`);
    await expect(own.getByTestId("status-thread-mnpqrstv")).toHaveAttribute("href", "/en/alerts/mnpqrstv");
    // A link holds no other link: the thread links are beside the building's link, not inside it.
    await expect(page.getByTestId(`home-building-${MILEPOST}`).locator("a")).toHaveCount(0);
    const area = page.getByTestId("home-neighbourhood-TP");
    await expect(area.getByTestId("home-status")).toHaveText(catalogText("en", "status.active"));
    await expect(area.getByTestId("status-thread-mnpqrstv")).toHaveAttribute("href", "/en/alerts/mnpqrstv");
  });

  test("links a resolved building and neighbourhood to the closed thread behind them (S05.07)", async ({ page }) => {
    await stubFeed(page, [feedOf(4, { buildings: { [MILEPOST]: { status: "resolved" } }, neighbourhoods: { TP: { status: "resolved" } } })]);
    await stubArchive(page, [closedThread(SLUG, MILEPOST)]);
    await choose(page);

    await openResident(page, "/en", 390);
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");

    const own = page.getByTestId(`home-building-threads-${MILEPOST}`);
    await expect(own.getByTestId(`status-thread-${SLUG}`)).toHaveAttribute("href", `/en/alerts/${SLUG}`);
    // The thread covers the building and not the neighbourhood: the neighbourhood's row says resolved and names none.
    await expect(page.getByTestId("home-neighbourhood-TP").getByTestId("home-status")).toHaveText(catalogText("en", "status.resolved"));
    await expect(page.getByTestId("home-neighbourhood-threads-TP")).toHaveCount(0);
    await own.getByTestId(`status-thread-${SLUG}`).click();
    await expect(page).toHaveURL(new RegExp(`/en/alerts/${SLUG}$`));
  });

  test("shows no thread links for a place with nothing active", async ({ page }) => {
    await stubFeed(page, [feedOf(4)]);
    await choose(page);

    await openResident(page, "/en", 390);
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");

    await expect(page.locator(".home-threads")).toHaveCount(0);
  });
});
