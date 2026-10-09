import { expect, test, type Page, type Request } from "@playwright/test";
import { BUILDINGS, FLOOR, seedChoices, stubBuildingList } from "./choices-fixture";
import { newServer, stubDirectory } from "./directory-fixture";
import { openResident } from "./helpers";
import { stubMap } from "./map-fixture";
import { expectUsageRequest, seenRequest, stubMetrics, type SeenRequest } from "./usage-fixture";

// S02.15, AR-26, FR-M1, FR-M3: the app sends usage events and nothing that identifies the phone or the resident. Each page of the directory, the
// map, the guides and the essential numbers sends one `{evt, lang, nbhd?}`; installing sends one install event, once. A resident with saved
// choices sends the same events as anyone else: the saved selection is in none of them (S02.03's rule still holds).

const SAVED = {
  v: 1,
  lang: "en",
  welcomed: true,
  groups: ["seniors", "newcomers"],
  buildings: [BUILDINGS[0].rsn, BUILDINGS[3].rsn],
  floors: [FLOOR.milepost2, FLOOR.overlea1],
  muted: ["zz-muted-topic"],
  basic: true,
};
const SECRETS = [BUILDINGS[0].rsn, BUILDINGS[3].rsn, FLOOR.milepost2, FLOOR.overlea1, "seniors", "newcomers", "zz-muted-topic", "cvh.choices", "cvh.install-reported"];

/** Waits for `count` events to have been counted; the pages send them as soon as they open. */
const events = (seen: { events: unknown[] }, count: number) => expect.poll(() => seen.events.length).toBe(count);

test.describe("a view of a page", () => {
  test("is one event with the page language, and the neighbourhood only where the page is about one", async ({ page }) => {
    await stubBuildingList(page);
    await stubDirectory(page, newServer(7));
    const seen = await stubMetrics(page);

    await openResident(page, "/en/directory", 390);
    await events(seen, 1);
    await openResident(page, "/ur/directory", 390);
    await events(seen, 2);
    // A listing: the neighbourhood is the listing's own, when it names exactly one.
    await openResident(page, "/en/directory/P101", 390);
    await events(seen, 3);
    await openResident(page, "/en/directory/P102", 390);
    await events(seen, 4);
    await openResident(page, "/en/directory/P103", 390);
    await events(seen, 5);
    // A provider the release does not have is not a listing viewed.
    await openResident(page, "/en/directory/P999", 390);
    await expect(page.getByTestId("provider-not-found")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await openResident(page, "/en/ready/numbers", 390);
    await events(seen, 6);
    await openResident(page, "/fr/ready/power", 390);
    await events(seen, 7);

    expect(seen.events).toEqual([
      { evt: "directory_view", lang: "en" },
      { evt: "directory_view", lang: "ur" },
      { evt: "listing_view", lang: "en", nbhd: "TP" },
      { evt: "listing_view", lang: "en", nbhd: "FP" },
      { evt: "listing_view", lang: "en" },
      { evt: "numbers_view", lang: "en" },
      { evt: "guide_view", lang: "fr" },
    ]);
  });

  test("carries the one neighbourhood the directory is filtered to, and none for both or neither", async ({ page }) => {
    await stubBuildingList(page);
    await stubDirectory(page, newServer(7));
    const seen = await stubMetrics(page);

    await openResident(page, "/en/directory", 390);
    await events(seen, 1);
    await page.getByTestId("filters-toggle").click();
    await page.getByTestId("filter-neighbourhood-TP").check();
    await openResident(page, "/en/directory", 390);
    await events(seen, 2);
    await page.getByTestId("filters-toggle").click();
    await page.getByTestId("filter-neighbourhood-FP").check();
    await openResident(page, "/en/directory", 390);
    await events(seen, 3);

    expect(seen.events).toEqual([
      { evt: "directory_view", lang: "en" },
      { evt: "directory_view", lang: "en", nbhd: "TP" },
      { evt: "directory_view", lang: "en" },
    ]);
  });

  test("on the map is one event, with the neighbourhood filter the visit began with", async ({ page }) => {
    await stubMap(page);
    const seen = await stubMetrics(page);

    await openResident(page, "/en/map", 390);
    await events(seen, 1);
    await page.evaluate(() => sessionStorage.setItem("cvh.directory-filters", JSON.stringify({ v: 1, categories: [], neighbourhoods: ["FP"], emergency: false })));
    await openResident(page, "/ur/map", 390);
    await events(seen, 2);

    expect(seen.events).toEqual([
      { evt: "map_view", lang: "en" },
      { evt: "map_view", lang: "ur", nbhd: "FP" },
    ]);
  });

  test("by a resident with saved choices carries none of them: the same events anyone sends, no cookie, no referrer, nothing else", async ({ page }) => {
    await stubBuildingList(page);
    await stubDirectory(page, newServer(7));
    await seedChoices(page, JSON.stringify(SAVED));
    const seen = await stubMetrics(page);
    const pending: Promise<SeenRequest>[] = [];
    page.context().on("request", (request: Request) => pending.push(seenRequest(request)));

    for (const path of ["/en/directory", "/en/directory/P101", "/en/ready/numbers", "/en/ready/power"]) {
      await openResident(page, path, 390);
      await page.waitForLoadState("networkidle");
    }
    await events(seen, 4);

    expect(seen.events).toEqual([
      { evt: "directory_view", lang: "en" },
      { evt: "listing_view", lang: "en", nbhd: "TP" },
      { evt: "numbers_view", lang: "en" },
      { evt: "guide_view", lang: "en" },
    ]);
    const all = await Promise.all(pending);
    const sent = all.filter((request) => new URL(request.url).pathname === "/api/metrics");
    expect(sent).toHaveLength(4);
    for (const request of sent) {
      expectUsageRequest(request);
      for (const secret of SECRETS) expect(`${request.url}\n${request.headers}\n${request.body}`, secret).not.toContain(secret);
    }
    // Nowhere else is the saved selection sent, with usage events on every page (S02.03).
    for (const request of all.filter((one) => new URL(one.url).origin === new URL(page.url()).origin)) {
      for (const secret of SECRETS) expect(`${request.url}\n${request.headers}\n${request.body}`, `${request.url} carries ${secret}`).not.toContain(secret);
    }
  });

  test("is dropped when the server cannot count it: the page works and nothing is sent again", async ({ page }) => {
    await stubDirectory(page, newServer(7));
    let tries = 0;
    await page.context().route("**/api/metrics", (route) => {
      tries += 1;
      return route.fulfill({ status: 503, json: { error: "unavailable" } });
    });

    await openResident(page, "/en/directory", 390);
    await expect(page.getByTestId("directory-list")).toBeVisible();
    await page.waitForLoadState("networkidle");

    expect(tries).toBe(1);
  });
});

const dispatchInstalled = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
const flag = (page: Page) => page.evaluate(() => localStorage.getItem("cvh.install-reported"));

test.describe("the install event", () => {
  test("is sent once when the browser reports the app installed, with the neighbourhood the chosen buildings are all in, and never again from this phone", async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(page, JSON.stringify({ ...SAVED, buildings: [BUILDINGS[0].rsn, BUILDINGS[1].rsn], floors: [] }));
    const seen = await stubMetrics(page);

    await openResident(page, "/en", 390);
    await page.waitForLoadState("networkidle");
    expect(seen.events).toEqual([]);
    await dispatchInstalled(page);
    await events(seen, 1);
    await dispatchInstalled(page);
    await page.reload();
    await dispatchInstalled(page);
    await page.waitForLoadState("networkidle");

    expect(seen.events).toEqual([{ evt: "install", lang: "en", nbhd: "TP" }]);
    // The flag is a yes, and the event holds nothing of the buildings.
    expect(await flag(page)).toBe("1");
    expect(seen.requests[0].body).not.toMatch(/7000000/);
  });

  test("leaves the neighbourhood out when the chosen buildings are in both", async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(page, JSON.stringify({ ...SAVED, floors: [] }));
    const seen = await stubMetrics(page);

    await openResident(page, "/ur", 390);
    await page.waitForLoadState("networkidle");
    await dispatchInstalled(page);
    await events(seen, 1);

    expect(seen.events).toEqual([{ evt: "install", lang: "ur" }]);
  });

  test("leaves the neighbourhood out when no building is chosen, and then the install asks for no building list", async ({ page }) => {
    await seedChoices(page, JSON.stringify({ v: 1, welcomed: true }));
    const seen = await stubMetrics(page);
    const lists: string[] = [];
    page.context().on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/buildings") lists.push(request.url());
    });

    await openResident(page, "/en", 390);
    await page.waitForLoadState("networkidle");
    const before = lists.length;
    await dispatchInstalled(page);
    await events(seen, 1);
    await page.waitForLoadState("networkidle");

    expect(seen.events).toEqual([{ evt: "install", lang: "en" }]);
    expect(lists.length).toBe(before);
  });

  test("is sent when the app is first opened as an installed one, where the browser does not report the install, and only that once", async ({ page }) => {
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (query: string) => (query === "(display-mode: standalone)" ? ({ ...real("all"), matches: true, media: query } as MediaQueryList) : real(query));
    });
    const seen = await stubMetrics(page);

    await openResident(page, "/en", 390);
    await events(seen, 1);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await openResident(page, "/ur", 390);
    await page.waitForLoadState("networkidle");

    expect(seen.events).toEqual([{ evt: "install", lang: "en" }]);
    expect(await flag(page)).toBe("1");
  });

  test("is not sent again when the app is reloaded while the install event is still on its way", async ({ page }) => {
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (query: string) => (query === "(display-mode: standalone)" ? ({ ...real("all"), matches: true, media: query } as MediaQueryList) : real(query));
    });
    // The first event is answered only after the reload has begun, so the reload always lands while it is on its way; the browser then tells the
    // page the request failed, though the request goes on to the server without it. The flag must stay, or the reloaded page sends a second one.
    let answer = () => {};
    const held = new Promise<void>((resolve) => (answer = resolve));
    const seen = { events: [] as unknown[] };
    await page.context().route("**/api/metrics", async (route) => {
      seen.events.push(expectUsageRequest(await seenRequest(route.request())));
      await held;
      await route.fulfill({ status: 204, headers: { "Cache-Control": "no-store" } }).catch(() => {});
    });

    await openResident(page, "/en", 390);
    await events(seen, 1);
    await page.reload();
    answer();
    await page.waitForLoadState("networkidle");

    expect(seen.events).toEqual([{ evt: "install", lang: "en" }]);
    expect(await flag(page)).toBe("1");
  });

  test("is not queued without signal: nothing is sent, the flag is not set, and no earlier event comes when the signal is back", async ({ page, context }) => {
    const seen = await stubMetrics(page);
    await openResident(page, "/en", 390);
    await page.waitForLoadState("networkidle");

    await context.setOffline(true);
    await dispatchInstalled(page);
    expect(await flag(page)).toBeNull();

    // Signal back. A known event is sent next; anything queued earlier would have been sent before it, so it must be the only one.
    await context.setOffline(false);
    await page.goto("/en/ready/numbers");
    await events(seen, 1);
    await page.waitForLoadState("networkidle");
    expect(seen.events).toEqual([{ evt: "numbers_view", lang: "en" }]);
    expect(await flag(page)).toBeNull();
  });

  test("takes the flag back when it was not counted, so a later install is not lost", async ({ page }) => {
    await page.context().route("**/api/metrics", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
    await openResident(page, "/en", 390);
    await page.waitForLoadState("networkidle");

    await dispatchInstalled(page);
    await expect.poll(() => flag(page)).toBeNull();
  });
});
