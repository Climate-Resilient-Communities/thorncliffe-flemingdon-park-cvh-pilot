import { expect, test, type Locator, type Page } from "@playwright/test";
import { BUILDINGS, stubBuildingList } from "./choices-fixture";
import { newServer, stubDirectory } from "./directory-fixture";
import { feedOf, stubFeed } from "./home-fixture";
import { catalogText, openResident, waitForFonts } from "./helpers";
import { stubMap } from "./map-fixture";

// The resident desktop layout (src/ui/desktop.css, approved 2026-10-08): from the resident-wide breakpoint the navigation is in the
// header's row, before the page, and home, Find help, the directory, a provider and the map have columns side by side. A phone keeps
// its own layout (the bottom bar, one column). Checked in English and Urdu (right to left), with standard and large text and in
// simpler view, and for horizontal scrolling at 1024, 1280 and 1440 and at 200% zoom.

const MILEPOST = BUILDINGS[0].rsn;
const OVERLEA = BUILDINGS[3].rsn;

type Mode = { name: string; choices: Record<string, unknown> };
const MODES: Mode[] = [
  { name: "standard text", choices: {} },
  { name: "large text", choices: { textSize: "large" } },
  { name: "simpler view", choices: { basic: true } },
];

/** The phone holds these choices before every load: welcomed, two buildings, and the display mode. */
async function phoneHolds(page: Page, lang: string, choices: Record<string, unknown>) {
  await page.addInitScript(
    (value) => localStorage.setItem("cvh.choices", value),
    JSON.stringify({ v: 1, welcomed: true, lang, buildings: [OVERLEA, MILEPOST], ...choices }),
  );
}

async function stubAll(page: Page) {
  await stubBuildingList(page);
  await stubFeed(page, [feedOf(7, { buildings: { [MILEPOST]: { status: "active", verified: false }, [OVERLEA]: { status: "none" } } })]);
  await stubDirectory(page, newServer(7));
}

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };
const box = async (locator: Locator): Promise<Box> => {
  const b = (await locator.boundingBox())!;
  return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height, width: b.width, height: b.height };
};

/**
 * The two columns are side by side: next to each other in the reading direction (the first at the start: left in English, right in
 * Urdu), without overlapping, and starting on the same band of the page (each one's top is above the other's bottom).
 */
async function expectSideBySide(first: Locator, second: Locator, dir: "ltr" | "rtl") {
  const a = await box(first);
  const b = await box(second);
  if (dir === "ltr") expect(b.left, "the second column starts after the first ends").toBeGreaterThanOrEqual(a.right);
  else expect(b.right, "the second column ends before the first starts (right to left)").toBeLessThanOrEqual(a.left);
  expect(a.top).toBeLessThan(b.bottom);
  expect(b.top).toBeLessThan(a.bottom);
  expect(a.width).toBeGreaterThan(200);
  expect(b.width).toBeGreaterThan(200);
}

async function expectNoOverflow(page: Page, what: string) {
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    main: document.querySelector("main")!.scrollWidth - document.querySelector("main")!.clientWidth,
  }));
  expect(overflow, what).toEqual({ page: 0, main: 0 });
}

/** The header's row holds the four destinations; the bottom bar is not displayed. */
async function expectHeaderNavigation(page: Page, lang: string) {
  const header = await box(page.getByTestId("shell-header"));
  const nav = page.getByTestId("shell-topnav");
  await expect(nav).toBeVisible();
  await expect(page.getByTestId("shell-nav")).toBeHidden();
  // One navigation landmark of the app's (a guide's "Jump to" and the terms' contents are their own).
  await expect(page.getByRole("navigation", { name: catalogText(lang, "shell.navLabel"), exact: true })).toHaveCount(1);
  for (const id of ["now", "help", "map", "ready"]) {
    const item = await box(page.getByTestId(`shell-topnav-${id}`));
    expect(item.top, id).toBeGreaterThanOrEqual(header.top);
    expect(item.bottom, id).toBeLessThanOrEqual(header.bottom + 1);
  }
  // In the same row as the logo and the language button, not a bar under them.
  const logo = await box(page.getByTestId("shell-logo"));
  const language = await box(page.getByTestId("shell-lang-button"));
  const now = await box(page.getByTestId("shell-topnav-now"));
  for (const other of [logo, language]) {
    expect(now.top).toBeLessThan(other.bottom);
    expect(other.top).toBeLessThan(now.bottom);
  }
}

for (const lang of ["en", "ur"] as const) {
  const dir = lang === "ur" ? "rtl" : "ltr";
  for (const mode of MODES) {
    test.describe(`${lang}, ${mode.name}, 1280px`, () => {
      test.beforeEach(async ({ page }) => {
        await stubAll(page);
        await phoneHolds(page, lang, mode.choices);
      });

      test("home: the navigation is in the header row and comes first; the places and alerts beside Every day and the 911 note", async ({ page }) => {
        await openResident(page, `/${lang}`, 1280, 900);
        await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");
        await waitForFonts(page);
        await expectHeaderNavigation(page, lang);
        await expectSideBySide(page.getByTestId("home-main"), page.getByTestId("home-side"), dir);
        // The side column: Every day (with the way to text alerts), then the 911 note.
        const side = page.getByTestId("home-side");
        await expect(side.getByTestId("home-every-day")).toBeVisible();
        await expect(side.getByTestId("home-dest-getTextAlerts")).toBeVisible();
        await expect(side.locator('[data-component="not-911"]')).toBeVisible();
        // The main column: the buildings, the neighbourhood, the current alerts and the alerts that have ended.
        const main = page.getByTestId("home-main");
        for (const id of ["home-buildings", "home-neighbourhoods", "home-alerts", "home-archive"]) await expect(main.getByTestId(id)).toBeVisible();
        await expectNoOverflow(page, "home");

        // Keyboard: the header (its destinations and its tools) before anything in the page.
        const order: { id: string | null; inMain: boolean; inHeader: boolean }[] = [];
        await page.locator("body").focus();
        for (let n = 0; n < 12; n += 1) {
          await page.keyboard.press("Tab");
          order.push(
            await page.evaluate(() => {
              const at = document.activeElement!;
              return { id: at.getAttribute("data-testid"), inMain: !!at.closest("main"), inHeader: !!at.closest("header") };
            }),
          );
        }
        const firstInMain = order.findIndex((step) => step.inMain);
        expect(firstInMain, JSON.stringify(order)).toBeGreaterThan(0);
        expect(order.slice(0, firstInMain).every((step) => step.inHeader), JSON.stringify(order)).toBe(true);
        const ids = order.map((step) => step.id);
        for (const id of ["now", "help", "map", "ready"]) {
          expect(ids.indexOf(`shell-topnav-${id}`), id).toBeGreaterThanOrEqual(0);
          expect(ids.indexOf(`shell-topnav-${id}`), id).toBeLessThan(firstInMain);
        }
        expect(ids.indexOf("shell-topnav-now")).toBeLessThan(ids.indexOf("shell-topnav-help"));
      });

      test("Find help: the filters as a column beside the results, which are cards in a grid", async ({ page }) => {
        await openResident(page, `/${lang}/directory`, 1280, 900);
        await expect(page.getByTestId("directory-list")).toBeVisible();
        await waitForFonts(page);
        await expectHeaderNavigation(page, lang);
        const workspace = page.getByTestId("directory-workspace");
        await expectSideBySide(workspace.locator(":scope > :first-child"), workspace.locator(":scope > :nth-child(2)"), dir);
        // The filters are an open column: no Filters button.
        await expect(page.getByTestId("filter-panel")).toBeVisible();
        await expect(page.getByTestId("filters-toggle")).toBeHidden();
        if (mode.name === "standard text") {
          // Two cards to a row.
          const cards = page.locator("[data-testid=directory-list] > li");
          await expectSideBySide(cards.nth(0), cards.nth(1), dir);
        }
        await expectNoOverflow(page, "directory");
      });

      test("a provider: the details beside a panel with the place and the quick actions", async ({ page }) => {
        await openResident(page, `/${lang}/directory/P104`, 1280, 900);
        await expect(page.getByTestId("provider-P104")).toBeVisible();
        await waitForFonts(page);
        await expectSideBySide(page.getByTestId("provider-main"), page.getByTestId("provider-side"), dir);
        const side = page.getByTestId("provider-side");
        await expect(side.getByTestId("provider-side-call")).toHaveAttribute("href", /^tel:/);
        await expect(side.getByTestId("provider-side-directions")).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/);
        await expect(side.getByTestId("provider-side-directions")).toHaveAttribute("rel", "noopener noreferrer");
        // The small map is a picture of the whole area; simpler view has no map tiles anywhere.
        if (mode.name === "simpler view") await expect(side.getByTestId("provider-mini-map")).toHaveCount(0);
        else await expect(side.getByTestId("provider-mini-map")).toHaveAttribute("data-status", "ready");
        await expectNoOverflow(page, "provider");
      });

      test("the map: beside its list, which follows the map; simpler view is the list alone", async ({ page }) => {
        await stubMap(page);
        await openResident(page, `/${lang}/map`, 1280, 900);
        if (mode.name === "simpler view") {
          await expect(page.getByTestId("map-list")).toBeVisible();
          await expect(page.getByTestId("map-frame")).toBeHidden();
          await expectNoOverflow(page, "map list");
          return;
        }
        await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-status", "ready");
        await expect(page.getByTestId("map-list-providers")).toBeVisible();
        await expectSideBySide(page.getByTestId("map-frame"), page.getByTestId("map-list"), dir);
        // Both are on screen, so the Map / List switch is not.
        await expect(page.getByTestId("map-view-list")).toBeHidden();
        // The map fills most of the window's height.
        expect((await box(page.getByTestId("map-canvas"))).height).toBeGreaterThan(900 * 0.6);
        await expectNoOverflow(page, "map");
      });
    });
  }
}

test.describe("no horizontal scrolling", () => {
  for (const width of [1024, 1280, 1440]) {
    for (const lang of ["en", "ur"] as const) {
      test(`${lang} at ${width}px with large text, on every page with columns`, async ({ page }) => {
        await stubAll(page);
        await stubMap(page);
        await phoneHolds(page, lang, { textSize: "large" });
        for (const path of ["", "/search", "/directory", "/directory/P104", "/map", "/ready", "/ready/power", "/buildings/4154146", "/terms", "/choices"]) {
          await openResident(page, `/${lang}${path}`, width, 900);
          await expectHeaderNavigation(page, lang);
          await expectNoOverflow(page, `${lang}${path} at ${width}`);
        }
      });
    }
  }

  // 200% zoom of a 1280 px window is 640 CSS pixels: the phone layout, with nothing wider than the window.
  test("at 200% zoom (640 CSS px) the page is the phone layout and fits", async ({ page }) => {
    await stubAll(page);
    await phoneHolds(page, "en", {});
    for (const path of ["/en", "/en/directory", "/en/directory/P104", "/en/ready/power"]) {
      await openResident(page, path, 640, 450);
      await expect(page.getByTestId("shell-nav")).toBeVisible();
      await expect(page.getByTestId("shell-topnav")).toBeHidden();
      await expectNoOverflow(page, path);
    }
  });
});

test.describe("Be ready, a guide and the terms on a desktop", () => {
  test.beforeEach(async ({ page }) => {
    await phoneHolds(page, "en", {});
  });

  test("the guides are a grid of cards", async ({ page }) => {
    await openResident(page, "/en/ready", 1280, 900);
    const guides = page.locator("[data-testid=ready-guides] li");
    expect(await guides.count()).toBeGreaterThan(2);
    await expectSideBySide(guides.nth(0), guides.nth(1), "ltr");
  });

  test("a guide: Jump to is a column beside its parts", async ({ page }) => {
    await openResident(page, "/en/ready/power", 1280, 900);
    await expectSideBySide(page.getByTestId("guide-jump"), page.getByTestId("guide-body"), "ltr");
    // The 911 block stays above the guide, at the top of the page.
    expect((await box(page.locator('[data-component="not-911"]').first())).bottom).toBeLessThan((await box(page.getByTestId("guide-body"))).top);
  });

  test("the terms: the contents are a column beside the text", async ({ page }) => {
    await openResident(page, "/en/terms", 1280, 900);
    await expectSideBySide(page.getByTestId("terms-contents"), page.locator(".terms-sections"), "ltr");
  });
});

test("a phone keeps the bottom bar and one column", async ({ page }) => {
  await stubAll(page);
  await phoneHolds(page, "en", {});
  await openResident(page, "/en", 390);
  await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");
  await expect(page.getByTestId("shell-nav")).toBeVisible();
  await expect(page.getByTestId("shell-topnav")).toBeHidden();
  await expect(page.getByTestId("home-dest-getTextAlerts")).toBeHidden();
  const main = await box(page.getByTestId("home-main"));
  const side = await box(page.getByTestId("home-side"));
  expect(side.top).toBeGreaterThanOrEqual(main.bottom);
  // The bottom bar is below the page.
  expect((await box(page.getByTestId("shell-nav"))).top).toBeGreaterThanOrEqual((await box(page.getByTestId("shell-main"))).bottom - 1);
});
