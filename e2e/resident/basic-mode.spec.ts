import { expect, test, type Page, type Request } from "@playwright/test";
import { ALERTS_URL } from "./alerts-server";
import { BUILDINGS, stubBuildingList } from "./choices-fixture";
import { newServer, stubDirectory } from "./directory-fixture";
import { catalogText, expectBaseline, openResident, waitForFonts } from "./helpers";
import { feedOf, stubFeed } from "./home-fixture";
import { stubMap, TILE_URL } from "./map-fixture";

// S02.14: basic mode (X-07). The switch in the header and the control in R-34 turn it on and off; the choice is saved in device
// choices and nothing reaches the server; the page is in basic mode before its first paint; the screens drop what the prototype
// drops (`hide-basic`), the thread of an alert shows its latest entry with "Earlier updates: n", the map opens as the list and
// asks for no tiles, and the grids that collapse show one column.

const CHOICES = "cvh.choices";
const THREAD = "qrstvwxz";

const savedBasic = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.basic, CHOICES);
const htmlBasic = (page: Page) => page.locator("html").getAttribute("data-basic");

/** The phone holds these choices before the first page loads (every load, so a reload keeps them). */
async function phoneHolds(page: Page, choices: Record<string, unknown>) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [CHOICES, JSON.stringify({ v: 1, welcomed: true, ...choices })] as const);
}

test.describe("the switch (X-07)", () => {
  test("is in the header on every page as a switch with a name and a state in words, and turns the mode on and off for the page at once", async ({ page }) => {
    await stubFeed(page, [feedOf(1)]);
    await openResident(page, "/en", 390);
    const header = page.getByTestId("shell-header");
    const toggle = header.getByRole("switch", { name: /Bigger text, fewer things/ });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle).toContainText("Off");
    expect(await htmlBasic(page)).toBeNull();
    const normalSize = await page.locator("main p").first().evaluate((p) => parseFloat(getComputedStyle(p).fontSize));

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(toggle).toContainText("On");
    expect(await htmlBasic(page)).toBe("true");
    expect(await savedBasic(page)).toBe(true);
    const basicSize = await page.locator("main p").first().evaluate((p) => parseFloat(getComputedStyle(p).fontSize));
    expect(basicSize).toBeGreaterThan(normalSize);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tap-current").trim())).toBe("56px");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(await htmlBasic(page)).toBeNull();
    expect(await savedBasic(page)).toBeUndefined();
  });

  test("works from the keyboard: it is reached after the language button, and Space and Enter turn it", async ({ page }) => {
    await openResident(page, "/en/ready", 390);
    await page.getByTestId("shell-lang-button").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("basic-switch")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("basic-switch")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("basic-switch")).toHaveAttribute("aria-checked", "false");
  });

  test("saves the choice beside the other choices and sends nothing to the server", async ({ page }) => {
    await phoneHolds(page, { lang: "en", buildings: [BUILDINGS[0].rsn], groups: ["seniors"] });
    await stubFeed(page, [feedOf(1)]);
    await stubBuildingList(page);
    await openResident(page, "/en", 390);
    await page.waitForLoadState("networkidle");
    const sent: Request[] = [];
    page.on("request", (request) => sent.push(request));

    await page.getByTestId("basic-switch").click();
    await expect(page.getByTestId("basic-switch")).toHaveAttribute("aria-checked", "true");
    await page.waitForTimeout(500);

    expect(sent.map((request) => `${request.method()} ${request.url()}`)).toEqual([]);
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), CHOICES);
    expect(saved).toMatchObject({ v: 1, lang: "en", buildings: [BUILDINGS[0].rsn], groups: ["seniors"], basic: true });
  });

  test("a page that loads with basic mode saved is in basic mode before its first paint, on every page", async ({ page }) => {
    await phoneHolds(page, { basic: true });
    // The time the attribute appeared, and the time of the first paint, in the page's own clock.
    await page.addInitScript(() => {
      const w = window as unknown as { __basicSetAt: number | null };
      w.__basicSetAt = null;
      // Observed from the document: <html> does not exist yet when an init script runs.
      new MutationObserver(() => {
        if (w.__basicSetAt === null && document.documentElement?.hasAttribute("data-basic")) w.__basicSetAt = performance.now();
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-basic"] });
    });
    for (const path of ["/en", "/ur/ready", "/ta/terms"]) {
      await page.goto(path);
      await page.waitForLoadState("load");
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const times = await page.evaluate(() => ({
        set: (window as unknown as { __basicSetAt: number | null }).__basicSetAt,
        paint: performance.getEntriesByName("first-paint")[0]?.startTime ?? performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
      }));
      expect(times.set, path).not.toBeNull();
      expect(times.paint, path).toBeGreaterThan(0);
      expect(times.set!, `${path}: the attribute is set before the first paint`).toBeLessThan(times.paint!);
      expect(await htmlBasic(page)).toBe("true");
    }
  });

  test("a saved value that is not exactly true leaves the page in normal mode", async ({ page }) => {
    for (const raw of ['{"v":1,"basic":"true"}', '{"v":1,"basic":1}', '{"v":2,"basic":true}', "not json", '{"v":1,"basic":false}']) {
      await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [CHOICES, raw] as const);
      await page.goto("/en/terms");
      expect(await htmlBasic(page), raw).toBeNull();
      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear());
    }
  });

  test("keeps the other tabs in step: a change made in another tab is followed by this one", async ({ page }) => {
    await openResident(page, "/en/terms", 390);
    const other = await page.context().newPage();
    await other.goto("/en/terms");
    await other.getByTestId("basic-switch").click();
    await expect(page.locator("html")).toHaveAttribute("data-basic", "true");
    await expect(page.getByTestId("basic-switch")).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("R-34 (my choices)", () => {
  test("always shows the mode and a control to turn it on or off", async ({ page }) => {
    await stubBuildingList(page);
    await openResident(page, "/en/choices", 390);
    const section = page.getByTestId("told-basic");
    await expect(section).toContainText("Bigger text, fewer things");
    await expect(page.getByTestId("told-basic-value")).toHaveText("Off");
    await expect(page.getByTestId("change-basic")).toHaveText(catalogText("en", "x07.turnOn"));

    await page.getByTestId("change-basic").click();
    expect(await htmlBasic(page)).toBe("true");
    expect(await savedBasic(page)).toBe(true);
    await expect(page.getByTestId("told-basic-value")).toHaveText("On");
    await expect(page.getByTestId("change-basic")).toHaveText("Turn off");
    await expect(page.getByTestId("basic-switch")).toHaveAttribute("aria-checked", "true");

    await page.getByTestId("change-basic").click();
    expect(await htmlBasic(page)).toBeNull();
    expect(await savedBasic(page)).toBeUndefined();
    await expect(page.getByTestId("told-basic-value")).toHaveText("Off");
  });

  test("the header switch and R-34 stay in step, in Urdu too", async ({ page }) => {
    await stubBuildingList(page);
    await openResident(page, "/ur/choices", 390);
    await page.getByTestId("basic-switch").click();
    await expect(page.getByTestId("change-basic")).toHaveText(catalogText("ur", "R34.turnOff"));
    await expect(page.getByTestId("told-basic-value")).toHaveText(catalogText("ur", "R34.on"));
  });
});

test.describe("what basic mode leaves out", () => {
  test("a lead or a second line of a screen is not shown, and is shown again in normal mode", async ({ page }) => {
    await openResident(page, "/en/ready", 390);
    const lead = page.getByText(catalogText("en", "R24.lead"));
    await expect(lead).toBeVisible();
    await expect(page.locator(".ready-dest__line").first()).toBeVisible();
    await page.getByTestId("basic-switch").click();
    await expect(lead).toBeHidden();
    await expect(page.locator(".ready-dest__line").first()).toBeHidden();
    await page.getByTestId("basic-switch").click();
    await expect(lead).toBeVisible();
  });

  test("the topic tiles of the ask screen and the actions of a step are one column at 390 px", async ({ page }) => {
    await stubDirectory(page, newServer(11));
    await openResident(page, "/en/search", 390);
    await expect(page.locator(".ask-topics")).toBeVisible();
    const columns = () => page.locator(".ask-topics").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(await columns()).toBeGreaterThan(1);
    const gap = await page.locator(".ask-topics").evaluate((el) => getComputedStyle(el).rowGap);
    await page.getByTestId("basic-switch").click();
    expect(await columns()).toBe(1);
    expect(await page.locator(".ask-topics").evaluate((el) => getComputedStyle(el).rowGap), "the gap is the same as in normal mode").toBe(gap);
  });

  test("the pairs of buttons of a step are one column, with the same gap (Grid itself is covered by e2e/layout/grid.spec.ts)", async ({ page }) => {
    await stubBuildingList(page);
    await openResident(page, "/en/choices/place", 390);
    const actions = page.locator(".choice-actions").first();
    await expect(actions).toBeVisible();
    const read = () => actions.evaluate((el) => ({ columns: getComputedStyle(el).gridTemplateColumns.split(" ").length, gap: getComputedStyle(el).columnGap }));
    const normal = await read();
    await page.getByTestId("basic-switch").click();
    expect(await read()).toEqual({ columns: 1, gap: normal.gap });
  });
});

test.describe("the thread of an alert (R-07)", () => {
  test.use({ baseURL: ALERTS_URL });

  test("in basic mode shows the latest entry and \"Earlier updates: n\"; the button brings the rest and moves focus to the first of them", async ({ page }) => {
    await phoneHolds(page, { basic: true });
    await openResident(page, `/en/alerts/${THREAD}`, 390, 900);
    const entries = page.locator("ol.alert-thread > li");
    const total = await entries.count();
    expect(total).toBeGreaterThan(1);
    await expect(entries.filter({ visible: true })).toHaveCount(1);
    await expect(entries.first()).toBeVisible();

    const more = page.getByTestId("alert-earlier-more");
    await expect(more).toHaveText(`Earlier updates: ${total - 1}`);
    expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    await more.click();
    await expect(entries.filter({ visible: true })).toHaveCount(total);
    await expect(more).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.className ?? "")).toContain("basic-earlier__item");
  });

  test("in normal mode every entry is shown and the button is not on screen; turning basic mode on hides the earlier ones", async ({ page }) => {
    await openResident(page, `/en/alerts/${THREAD}`, 390, 900);
    const entries = page.locator("ol.alert-thread > li");
    const total = await entries.count();
    await expect(entries.filter({ visible: true })).toHaveCount(total);
    await expect(page.getByTestId("alert-earlier-more")).toBeHidden();

    await page.getByTestId("basic-switch").click();
    await expect(entries.filter({ visible: true })).toHaveCount(1);
    await expect(page.getByTestId("alert-earlier-more")).toBeVisible();
  });

  test("only the first guide is shown in basic mode", async ({ page }) => {
    await openResident(page, "/en/alerts/mnpqrstv", 390, 900);
    const guides = page.locator("[data-testid^=alert-guide-]");
    const total = await guides.count();
    expect(total).toBeGreaterThan(1);
    await expect(guides.filter({ visible: true })).toHaveCount(total);
    await page.getByTestId("basic-switch").click();
    await expect(guides.filter({ visible: true })).toHaveCount(1);
  });
});

test.describe("the map (R-14)", () => {
  test("opens as the list in basic mode, with no tiles asked for, the whole area in it, and no way into the map view", async ({ page }) => {
    const server = await stubMap(page);
    await phoneHolds(page, { basic: true });
    const tiles: string[] = [];
    page.on("request", (request) => TILE_URL.test(request.url()) && tiles.push(request.url()));
    await openResident(page, "/en/map", 390);
    await expect(page.getByTestId("map-list")).toBeVisible();
    await expect(page.getByTestId("map-list-providers")).toBeVisible();
    await expect(page.getByTestId("map-frame")).toBeHidden();
    await expect(page.getByTestId("map-view-map")).toBeHidden();
    await page.waitForTimeout(500);
    expect(tiles).toEqual([]);
    expect(server.tileRequests).toEqual([]);
    expect(await page.locator(".leaflet-container").count()).toBe(0);
    await waitForFonts(page);
    await expectBaseline(page, "basic-map-list-en-390.png");
  });

  test("turning basic mode on from the header takes the map away and shows the list; turning it off gives the map back", async ({ page }) => {
    await stubMap(page);
    await openResident(page, "/en/map", 390);
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-status", "ready");
    await page.getByTestId("basic-switch").click();
    await expect(page.getByTestId("map-list")).toBeVisible();
    await expect(page.getByTestId("map-frame")).toBeHidden();
    await page.getByTestId("basic-switch").click();
    await expect(page.getByTestId("map-view-map")).toBeVisible();
    await page.getByTestId("map-view-map").click();
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-status", "ready");
    await expect(page.getByTestId("map-frame")).toBeVisible();
  });
});

// Baselines of basic mode on screens that change most: the header with the switch on, bigger text, the one-column tiles.
for (const lang of ["en", "ur"] as const) {
  test(`${lang}: basic mode at 390 px matches its baselines`, async ({ page }) => {
    await phoneHolds(page, { basic: true });
    await stubFeed(page, [feedOf(1)]);
    await openResident(page, `/${lang}`, 390);
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");
    await waitForFonts(page);
    await expectBaseline(page, `basic-home-${lang}-390.png`);
    await openResident(page, `/${lang}/search`, 390);
    await expectBaseline(page, `basic-search-${lang}-390.png`);
    await stubBuildingList(page);
    await openResident(page, `/${lang}/choices`, 390);
    await expect(page.getByTestId("told-basic")).toBeVisible();
    await expectBaseline(page, `basic-choices-${lang}-390.png`);
  });
}
