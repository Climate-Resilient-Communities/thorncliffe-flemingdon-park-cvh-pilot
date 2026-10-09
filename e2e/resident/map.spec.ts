import axe from "axe-core";
import { expect, test, type Page, type Request } from "@playwright/test";
import { IN_HOME_VIEW, IN_MIDDLE, MAP_BUILDINGS, stubMap, TILE_URL, type MapServer } from "./map-fixture";
import { expectBaseline, openResident, waitForFonts } from "./helpers";
import { expectUsageRequest, isUsageRequest, seenRequest } from "./usage-fixture";

// S02.07: a resident finds providers and buildings on a map (/{lang}/map: R-14 map, R-15 list, R-16 preview). The release
// routes, the building list and the tile provider are answered by map-fixture.ts. The server runs with the default tile
// settings (src/platform/config/mapTiles.ts): CARTO Positron, viewed tiles kept on the phone, up to 200.

const CREDIT = "© OpenStreetMap contributors © CARTO";

// The pins on the map are Leaflet's marker icons (.leaflet-marker-icon): the list of places beside or behind the map draws the same
// marks (map-pin--inline), so a pin is looked for among the markers.

async function openMap(page: Page, lang = "en", width = 390): Promise<void> {
  await openResident(page, `/${lang}/map`, width);
  await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-status", "ready");
  await expect(page.locator(".map-pin").first()).toBeVisible();
  await waitForFonts(page);
}

/** The ids of the providers and the numbers of the buildings the list (R-15) shows. */
async function listed(page: Page): Promise<{ providers: string[]; buildings: string[] }> {
  const ids = (testId: string, prefix: string) =>
    page.locator(`[data-testid=${testId}] > li`).evaluateAll((items, p) => items.map((item) => item.getAttribute("data-testid")!.slice(p.length)), prefix);
  const providers = (await page.getByTestId("map-list-providers").count()) ? await ids("map-list-providers", "map-entry-") : [];
  const buildings = (await page.getByTestId("map-list-buildings").count()) ? await ids("map-list-buildings", "map-entry-building-") : [];
  return { providers: providers.sort(), buildings: buildings.sort() };
}

/** Presses a zoom button and waits until the map has settled on the next zoom. */
async function zoom(page: Page, way: "in" | "out") {
  const canvas = page.getByTestId("map-canvas");
  const before = Number(await canvas.getAttribute("data-zoom"));
  await page.locator(`.leaflet-control-zoom-${way}`).click();
  await expect(canvas).toHaveAttribute("data-zoom", String(way === "in" ? before + 1 : before - 1));
}

async function tilesSettled(page: Page) {
  await expect.poll(() => page.locator(".leaflet-tile-container .leaflet-tile:not(.leaflet-tile-loaded)").count()).toBe(0);
}

test.describe("the map (R-14)", () => {
  let server: MapServer;
  test.beforeEach(async ({ page }) => {
    server = await stubMap(page);
  });

  test("published providers and the buildings appear as clustered pins; cooling spaces, water fountains and washrooms have their own marker and words", async ({ page }) => {
    await openMap(page);
    await expect(page.locator(".leaflet-marker-icon.map-pin--cooling .map-pin__word")).toHaveText("Cooling Spaces");
    await expect(page.locator(".leaflet-marker-icon.map-pin--water .map-pin__word")).toHaveText("Water Fountains");
    await expect(page.locator(".leaflet-marker-icon.map-pin--washroom .map-pin__word")).toHaveText("Public Washrooms");
    await expect(page.locator(".leaflet-marker-icon.map-pin--building")).toHaveCount(MAP_BUILDINGS.length);
    // Two providers at one spot are one cluster, which says how many places are there.
    const cluster = page.locator(".map-cluster");
    await expect(cluster).toHaveCount(1);
    await expect(cluster).toContainText("2");
    await expect(cluster.locator(".map-sr")).toHaveText("2 places here");
    // Each kind has its own shape, not only another colour: the marks differ in their corners or their border.
    const shapes = await page.evaluate(() =>
      ["cooling", "water", "washroom", "service", "building"].map((kind) => {
        const mark = document.querySelector(`.map-pin--${kind} .map-pin__mark`);
        if (!mark) return `${kind}: missing`;
        const style = getComputedStyle(mark);
        return `${style.borderTopLeftRadius}|${style.transform}|${style.borderTopStyle}|${style.borderTopWidth}|${style.inlineSize}`;
      }),
    );
    expect(new Set(shapes).size).toBe(5);
    // The provider's required credit is on the map.
    await expect(page.getByTestId("map-credit")).toHaveText(CREDIT);
    await expectBaseline(page, "map-en-390.png");
  });

  // Production UAT, 2026-10-08: at 390 px a pin under the zoom buttons was a 44 by 13 px target (axe target-size, WCAG 2.5.8).
  for (const lang of ["en", "ur"]) {
    test(`nothing is drawn over a pin: the zoom buttons are in a bar above the map and the credit under it (${lang})`, async ({ page }) => {
      await openMap(page, lang, 390);
      await expect(page.getByTestId("map-canvas").locator(".leaflet-control")).toHaveCount(0);
      await expect(page.getByTestId("map-tools").locator(".leaflet-control-zoom-in")).toBeVisible();
      const [tools, canvas, credit] = await Promise.all(["map-tools", "map-canvas", "map-credit"].map((id) => page.getByTestId(id).boundingBox()));
      expect(tools!.y + tools!.height).toBeLessThanOrEqual(canvas!.y + 1);
      expect(credit!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height - 1);
      await zoom(page, "in");
      await zoom(page, "out");
      await page.addScriptTag({ content: axe.source });
      const found = await page.evaluate(async () => {
        const result = await (window as unknown as { axe: typeof axe }).axe.run(document, { runOnly: ["target-size", "scrollable-region-focusable"] });
        return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
      });
      expect(found).toEqual([]);
    });
  }

  test("the credit and the labels are shown in a right-to-left language too", async ({ page }) => {
    await openMap(page, "ur");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("map-credit")).toHaveText(CREDIT);
    await expect(page.getByTestId("map-credit")).toHaveAttribute("lang", "en");
    await expect(page.locator(".leaflet-marker-icon.map-pin--cooling .map-pin__word")).toHaveText("ٹھنڈک کی جگہیں");
    await expectBaseline(page, "map-ur-390.png");
  });

  test("a pin opens the preview card (R-16), which leads to the same listing as the directory", async ({ page }) => {
    await openMap(page);
    await page.locator(".leaflet-marker-icon.map-pin--cooling").click();
    const card = page.getByTestId("map-preview");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { name: "Overlea Cooling Centre" })).toBeVisible();
    await expect(page.getByTestId("map-preview-kind")).toHaveText("Cooling Spaces");
    await expect(card).toBeFocused();
    await page.getByTestId("map-preview-open").click();
    await expect(page).toHaveURL(/\/en\/directory\/M101$/);
    await expect(page.getByTestId("provider-page")).toBeVisible();
    await expect(page.getByTestId("provider-page")).toContainText("Overlea Cooling Centre");
  });

  test("a building pin leads to the building page; the card closes", async ({ page }) => {
    await openMap(page);
    await page.locator(".leaflet-marker-icon.map-pin--building").first().click();
    await expect(page.getByTestId("map-preview-kind")).toHaveText("Apartment building");
    await page.getByTestId("map-preview-close").click();
    await expect(page.getByTestId("map-preview")).toHaveCount(0);
    await page.locator(".leaflet-marker-icon.map-pin--building").first().click();
    const href = await page.getByTestId("map-preview-open").getAttribute("href");
    expect(MAP_BUILDINGS.map((b) => `/en/buildings/${b.rsn}`)).toContain(href);
    await page.getByTestId("map-preview-open").click();
    await expect(page.getByTestId("building-page")).toBeVisible();
  });

  test("the list (R-15) shows the same places as the part of the map on screen", async ({ page }) => {
    await openMap(page);
    await page.getByTestId("map-view-list").click();
    await expect(page.getByTestId("map-list")).toBeVisible();
    expect(await listed(page)).toEqual({ providers: IN_HOME_VIEW, buildings: MAP_BUILDINGS.map((b) => b.rsn).sort() });
    await expect(page.getByTestId("map-list-count")).toHaveText(`${IN_HOME_VIEW.length} places`);
    // Every entry is a link to the same page as its pin.
    await expect(page.getByTestId("map-entry-M104").getByRole("link")).toHaveAttribute("href", "/en/directory/M104");

    // Zoom in on the middle: the list follows the map.
    await page.getByTestId("map-view-map").click();
    await zoom(page, "in");
    await zoom(page, "in");
    await page.getByTestId("map-view-list").click();
    await expect.poll(() => listed(page)).toEqual({ providers: IN_MIDDLE, buildings: [] });
    await expectBaseline(page, "map-list-en-390.png");
  });

  test("the map has a name and the list is reachable without the map", async ({ page }) => {
    await openMap(page);
    await expect(page.getByRole("region", { name: "Map of Thorncliffe Park and Flemingdon Park" })).toBeVisible();
    await expect(page.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "List" }).click();
    await expect(page.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("map-frame")).toBeHidden();
    await expect(page.getByRole("link", { name: "Overlea Cooling Centre" })).toBeVisible();
  });

  test("viewed tiles are kept on the phone, only the tiles on screen are fetched, and a kept tile is not fetched again", async ({ page }) => {
    await openMap(page);
    await tilesSettled(page);
    const requested = [...server.tileRequests];
    const drawn = await page.locator(".leaflet-tile-container .leaflet-tile").count();
    expect(requested.length).toBeGreaterThan(0);
    // Nothing ahead of viewing: one request per tile on screen, each once.
    expect(new Set(requested).size).toBe(requested.length);
    expect(requested.length).toBe(drawn);
    const kept = await page.evaluate(async () => {
      const cache = await caches.open("cvh-map-tiles-v1");
      const index = JSON.parse(localStorage.getItem("cvh.map.tiles") ?? "{}") as { entries?: unknown[] };
      return { cached: (await cache.keys()).length, indexed: index.entries?.length ?? 0 };
    });
    expect(kept).toEqual({ cached: requested.length, indexed: requested.length });
    expect(kept.cached).toBeLessThanOrEqual(200);

    // The same view again comes from the phone.
    server.tileRequests.length = 0;
    await openMap(page);
    await tilesSettled(page);
    expect(server.tileRequests).toEqual([]);
  });

  test("offline: viewed areas show their saved tiles, unviewed areas say they are not saved, and the pins and list still work", async ({ page }) => {
    await openMap(page);
    await tilesSettled(page);
    await expect(page.getByTestId("map-not-saved")).toHaveCount(0);
    server.tilesDown = true;
    server.manifestDown = true;
    await page.context().setOffline(true);

    // A zoom level never viewed: nothing kept for it.
    await zoom(page, "in");
    await expect(page.getByTestId("map-not-saved")).toBeVisible();
    await expect(page.getByTestId("map-not-saved")).toContainText("This part of the map is not saved on your phone");
    await expect(page.locator(".map-pin").first()).toBeVisible();

    // Back to the area viewed with signal: its tiles come from the phone.
    await zoom(page, "out");
    await expect(page.getByTestId("map-not-saved")).toHaveCount(0);
    await tilesSettled(page);
    await expect(page.locator(".leaflet-tile.map-tile--missing")).toHaveCount(0);

    // The list works without signal.
    await page.getByTestId("map-view-list").click();
    expect((await listed(page)).providers).toEqual(IN_HOME_VIEW);
    await page.context().setOffline(false);
  });

  test("pins and the list come from the saved listing file when the server cannot be reached", async ({ page }) => {
    await openMap(page);
    server.manifestDown = true;
    server.listingDown = true;
    await openMap(page);
    await expect(page.getByTestId("map-last-updated")).toBeVisible();
    await expect(page.locator(".leaflet-marker-icon.map-pin--cooling")).toBeVisible();
    await page.getByTestId("map-view-list").click();
    expect((await listed(page)).providers).toEqual(IN_HOME_VIEW);
  });
});

test("map tiles are the only cross-origin request, and they carry nothing about the resident", async ({ page }) => {
  await stubMap(page);
  await page.addInitScript(() => {
    localStorage.setItem("cvh.choices", JSON.stringify({ v: 1, welcomed: true, lang: "en", groups: ["seniors"], buildings: ["4154146"], floors: [], muted: [], basic: false }));
  });
  const seen: Request[] = [];
  page.context().on("request", (request) => seen.push(request));
  await openMap(page);
  await page.locator(".leaflet-marker-icon.map-pin--cooling").click();
  await zoom(page, "in");
  await page.getByTestId("map-view-list").click();
  await page.waitForLoadState("networkidle");

  const origin = new URL(page.url()).origin;
  // Nothing the resident saved is in any request: not their building, not their groups (AD-3).
  for (const request of seen) {
    const text = `${request.url()}\n${JSON.stringify(await request.allHeaders())}\n${request.postData() ?? ""}`;
    for (const secret of ["4154146", "seniors", "cvh.choices"]) expect(text, request.url()).not.toContain(secret);
  }
  // The data requests are the ones every visitor makes.
  // S02.15: the usage events (map_view) are the one other request, and the fixed message.
  const usage = seen.filter((request) => isUsageRequest(request.url()));
  expect(usage.length).toBeGreaterThan(0);
  for (const request of usage) expectUsageRequest(await seenRequest(request));
  const data = seen.filter((request) => new URL(request.url()).origin === origin && new URL(request.url()).pathname.startsWith("/api/") && !isUsageRequest(request.url()));
  for (const request of data) expect(new URL(request.url()).pathname, request.url()).toMatch(/^\/api\/(?:directory\/manifest|directory\/\d+\/en\.json|buildings)$/);

  const crossOrigin = seen.filter((request) => !request.url().startsWith("data:") && !request.url().startsWith("blob:") && new URL(request.url()).origin !== origin);
  expect(crossOrigin.length).toBeGreaterThan(0);
  for (const request of crossOrigin) {
    expect(request.url(), request.url()).toMatch(TILE_URL);
    const headers = await request.allHeaders();
    expect(headers).not.toHaveProperty("cookie");
    // The Referer, if any, is the app's origin only: never the page path.
    if (headers.referer) expect(headers.referer).toBe(`${origin}/`);
  }
});
