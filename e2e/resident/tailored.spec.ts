import { expect, test, type Page } from "@playwright/test";
import en from "../../src/i18n/messages/en.json";
import { seedChoices, stubBuildingList } from "./choices-fixture";
import { stubFeed } from "./home-fixture";
import { expectBaseline, openResident } from "./helpers";
import { feedWithAlerts, SAVED_BUILDING, THREADS } from "./tailored-fixture";

// S04.09 (FR-A13, AR-26): home puts the alerts that are for this phone first and marks them, hides none, and adds one line of advice from the
// catalog (X-12) to an alert that is for it. All of it is worked out on the phone from the saved choices; the feed is the same for everyone.
// The privacy side (no request carries the saved selection, with alerts present) is e2e/resident/choices-network.spec.ts.

const SAVED = { v: 1, welcomed: true, buildings: [SAVED_BUILDING], groups: ["seniors"] };

async function openHome(page: Page, choices: object, path = "/en", width = 390) {
  await stubBuildingList(page);
  await stubFeed(page, [feedWithAlerts()]);
  await seedChoices(page, JSON.stringify(choices));
  await openResident(page, path, width);
  await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready");
}

const order = (page: Page) =>
  page.getByTestId("home-threads").locator("> li > a").evaluateAll((links) => links.map((link) => link.getAttribute("data-testid")!.replace("alert-card-", "")));
const marked = (page: Page) => page.locator("a.alert-card--mine").evaluateAll((links) => links.map((link) => link.getAttribute("data-testid")!.replace("alert-card-", "")));

test("puts the alerts for this phone first and marks them, and every other alert follows", async ({ page }) => {
  await openHome(page, SAVED);

  expect(await order(page)).toEqual([THREADS.MINE, THREADS.SENIORS_AREA, THREADS.FAR, THREADS.FAMILIES_AREA]);
  expect(await marked(page)).toEqual([THREADS.MINE, THREADS.SENIORS_AREA]);
  for (const slug of [THREADS.FAR, THREADS.FAMILIES_AREA]) await expect(page.getByTestId(`alert-card-${slug}`)).toBeVisible();
  await expect(page.getByTestId("no-current-alerts")).toHaveCount(0);
});

test("adds one line of advice from the catalog to each alert that is for this phone, and says nothing of the group or of why", async ({ page }) => {
  await openHome(page, SAVED);

  await expect(page.getByTestId(`alert-advice-${THREADS.MINE}`)).toContainText("What this means for you");
  await expect(page.getByTestId(`alert-advice-${THREADS.MINE}-line`)).toHaveText(en.tailored.elevator.seniors[0]);
  await expect(page.getByTestId(`alert-advice-${THREADS.SENIORS_AREA}-line`)).toHaveText(en.tailored.heat.seniors[0]);
  // Not on an alert that is not for this phone, and one line each.
  await expect(page.getByTestId(`alert-advice-${THREADS.FAR}`)).toHaveCount(0);
  await expect(page.getByTestId(`alert-advice-${THREADS.FAMILIES_AREA}`)).toHaveCount(0);
  await expect(page.locator('[data-testid^="alert-advice-"][data-testid$="-line"]')).toHaveCount(2);
  // No word of the group or of the reason in the alerts section, in its text or in its markup.
  const text = (await page.getByTestId("home-alerts").innerText()).toLowerCase();
  for (const word of ["senior", "newcomer", "famil", "tailored", "your choices", "because"]) expect(text).not.toContain(word);
  expect(await page.getByTestId("home-alerts").innerHTML()).not.toMatch(/senior|newcomer|famil/i);
  // The advice is not inside the link: a card that is a link holds no other.
  await expect(page.getByTestId(`alert-card-${THREADS.MINE}`).getByTestId(`alert-advice-${THREADS.MINE}`)).toHaveCount(0);
});

test("a phone with another group gets the line for that group, in the feed's order among the alerts that are for it", async ({ page }) => {
  await openHome(page, { v: 1, welcomed: true, buildings: [SAVED_BUILDING], groups: ["families"] });
  expect(await order(page)).toEqual([THREADS.FAMILIES_AREA, THREADS.MINE, THREADS.FAR, THREADS.SENIORS_AREA]);
  await expect(page.getByTestId(`alert-advice-${THREADS.MINE}-line`)).toHaveText(en.tailored.elevator.families[0]);
  await expect(page.getByTestId(`alert-advice-${THREADS.FAMILIES_AREA}-line`)).toHaveText(en.tailored.heat.families[0]);
});

test("a phone with a building and no group has that building's alert first and no advice", async ({ page }) => {
  await openHome(page, { v: 1, welcomed: true, buildings: [SAVED_BUILDING] });

  expect(await order(page)).toEqual([THREADS.MINE, THREADS.FAR, THREADS.FAMILIES_AREA, THREADS.SENIORS_AREA]);
  expect(await marked(page)).toEqual([THREADS.MINE]);
  await expect(page.locator('[data-testid^="alert-advice-"]')).toHaveCount(0);
});

test("a phone with nothing saved sees every alert in the feed's order, none marked and no advice", async ({ page }) => {
  await openHome(page, { v: 1, welcomed: true });

  const slugs = await order(page);
  expect(slugs).toHaveLength(4);
  expect([...slugs].sort()).toEqual([THREADS.FAR, THREADS.FAMILIES_AREA, THREADS.MINE, THREADS.SENIORS_AREA].sort());
  await expect(page.locator("a.alert-card--mine")).toHaveCount(0);
  await expect(page.locator('[data-testid^="alert-advice-"]')).toHaveCount(0);
});

test("a phone with a group and no building is tailored to nothing: the feed's order, none marked and no advice", async ({ page }) => {
  await openHome(page, { v: 1, welcomed: true, groups: ["seniors"] });

  expect(await order(page)).toHaveLength(4);
  await expect(page.locator("a.alert-card--mine")).toHaveCount(0);
  await expect(page.locator('[data-testid^="alert-advice-"]')).toHaveCount(0);
});

test("an advice line with no translation is shown in English, left to right, and the page says once that part of it is in English", async ({ page }) => {
  await openHome(page, SAVED, "/ur");

  const line = page.getByTestId(`alert-advice-${THREADS.MINE}-line`);
  await expect(line).toHaveText(en.tailored.elevator.seniors[0]);
  await expect(line).toHaveAttribute("lang", "en");
  await expect(line).toHaveAttribute("dir", "ltr");
  await expect(line).toHaveAttribute("data-translation", "unavailable");
  await expect(page.getByTestId("home-content-fallback")).toHaveCount(1);
  expect(await page.getByTestId(`alert-advice-${THREADS.MINE}`).innerText()).not.toContain("[EN]");
});

for (const [lang, width] of [["en", 320], ["ur", 390]] as const) {
  test(`${lang}: the marked cards and the advice have no horizontal scrolling at ${width} px, and every link is at least 44 px`, async ({ page }) => {
    await openHome(page, SAVED, `/${lang}`, width);

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main a[href]")]
        .filter((element) => element.checkVisibility())
        .filter((element) => element.getBoundingClientRect().height < 44)
        .map((element) => element.outerHTML.slice(0, 60)),
    );
    expect(small).toEqual([]);
  });
}

for (const lang of ["en", "ur"] as const) {
  test(`${lang}: home with a marked card and its advice matches its baseline screenshot at 390 px`, async ({ page }) => {
    await openHome(page, SAVED, `/${lang}`, 390);
    await expect(page.getByTestId(`alert-advice-${THREADS.MINE}`)).toBeVisible();
    // The whole page, so the baseline shows the cards in order and the advice under them.
    const needed = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      return Math.ceil(main.scrollHeight + document.documentElement.clientHeight - main.clientHeight);
    });
    await page.setViewportSize({ width: 390, height: needed });

    await expectBaseline(page, `tailored-home-${lang}-390.png`);
  });
}
