import { expect, test, type Locator, type Page } from "@playwright/test";
import { providerFiltersLabels, providerListLabels } from "../../src/app/staff/providers/labels";
import type { ProviderRowData } from "../../src/app/staff/providers/ProviderList";
import { englishText } from "../../src/i18n/text";
import { box, type Box } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mountHydrated } from "../helpers/layout-fixture";

// The Providers screen, compact (S02.04): the filter tabs and the search over the list; each row is its name with a status pill and the
// actions menu (⋯) at the end of the line, the code and street under it, then the verified badge's line, whose "Change" or "Confirm"
// opens the date field and Save date under it. Every target is at least 44 px, nothing scrolls sideways, and the menu opens by keyboard,
// closes with Escape and gives focus back to its button.
const brand = hubBrand();
const row = (id: string, change: Partial<ProviderRowData> = {}): ProviderRowData => ({
  id,
  name: `Provider ${id}`,
  detail: `${id} · Community Resilience · ${id.slice(1)} Overlea Blvd`,
  published: false,
  inCatalogue: true,
  lastConfirmed: null,
  ...change,
});
const LONG = "Thorncliffe Park Women's Committee and Neighbourhood Food Security Network";
const ROWS = [
  row("M901"),
  row("M902", { lastConfirmed: "2026-09-20" }),
  row("M903", { published: true, lastConfirmed: "2026-09-28" }),
  row("M904", { name: LONG, published: true, lastConfirmed: "2026-10-02" }),
];

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  const texts = { ...REAL_TEXTS, heading: englishText("staff.providers.title"), paragraphs: [englishText("staff.providers.lead")] };
  await mountHydrated(page, "ProvidersFixture", { texts, brand, rows: ROWS, labels: providerListLabels(), filterLabels: providerFiltersLabels(), today: "2026-10-02" }, { lang: "en" });
}

const centre = (b: Box) => b.top + b.height / 2;
const isTarget = (b: Box) => Math.min(b.width, b.height) >= 44;

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "no horizontal scrolling").toBe(0);
}

/** The first line box of an element's text. */
const firstLine = (locator: Locator): Promise<Box> =>
  locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = range.getClientRects()[0];
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  });

for (const width of [320, 390, 1280]) {
  test(`providers at ${width}px: tabs and search, then each row's name, pill and menu on one line and the badge's line under them`, async ({ page }) => {
    await open(page, width);

    // The tabs: targets on one line; the search field and its button share a top and a height.
    const tabs = await Promise.all(["all", "confirm", "hidden"].map((filter) => box(page.getByTestId(`provider-tab-${filter}`))));
    for (const tab of tabs) expect(isTarget(tab), "a tab is a 44 px target").toBe(true);
    expect(new Set(tabs.map((tab) => Math.round(tab.top))).size, "the tabs share a line").toBe(1);
    const [field, search] = await Promise.all([box(page.getByLabel("Search by name or code")), box(page.getByRole("button", { name: "Search", exact: true }))]);
    expect(Math.abs(field.top - search.top)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(field.height - search.height)).toBeLessThanOrEqual(0.5);
    expect(search.left, "Search follows its field").toBeGreaterThan(field.right);
    for (const target of [field, search]) expect(isTarget(target)).toBe(true);

    for (const { id, name } of ROWS) {
      const record = page.getByTestId(`provider-${id}`);
      const [rowBox, heading, pill, menu, detail, line, icon, words, change] = await Promise.all([
        box(record),
        box(record.getByRole("heading", { level: 2 })),
        box(page.getByTestId(`provider-${id}-status`)),
        box(record.getByLabel(`Actions for ${name}`, { exact: true })),
        box(record.locator(".provider-row__detail")),
        box(page.getByTestId(`provider-${id}-change`)),
        box(page.getByTestId(`provider-${id}-confirmed`).locator("svg")),
        firstLine(page.getByTestId(`provider-${id}-confirmed`).locator(".verified__text")),
        box(record.locator(".provider-row__change")),
      ]);
      // Line 1: the menu at the end of the row; the pill follows the name, centred on the menu's line.
      expect(Math.abs(menu.right - rowBox.right), `${id}: the menu is at the end of the row`).toBeLessThanOrEqual(0.5);
      expect(pill.left, `${id}: the pill follows the name`).toBeGreaterThanOrEqual(heading.right);
      expect(menu.left, `${id}: the menu follows the pill`).toBeGreaterThan(pill.right);
      expect(Math.abs(centre(pill) - centre(menu)), `${id}: the pill is centred on the menu's line`).toBeLessThanOrEqual(1);
      // The muted line under it, then the badge's line.
      expect(detail.top, `${id}: the code and street are under the name`).toBeGreaterThanOrEqual(Math.max(heading.bottom, menu.bottom) - 0.5);
      expect(line.top, `${id}: the badge's line is under them`).toBeGreaterThanOrEqual(detail.bottom - 0.5);
      // The badge starts the line, centred on the first line of its words, and "Change" follows them on that line.
      expect(Math.abs(icon.left - rowBox.left), `${id}: the badge starts the line`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(centre(icon) - centre(words)), `${id}: the badge is centred on its words`).toBeLessThanOrEqual(1);
      expect(icon.width, `${id}: the badge is 16 px`).toBe(16);
      expect(change.left, `${id}: Change follows the words`).toBeGreaterThan(words.right);
      expect(Math.abs(centre(change) - centre(words)), `${id}: Change is on the words' line`).toBeLessThanOrEqual(1);
      for (const target of [menu, line]) expect(isTarget(target), `${id}: a 44 px target`).toBe(true);
    }
    await expectNoOverflow(page);
  });

  test(`providers at ${width}px: Change opens the date field and Save date, one aligned group under the badge's line`, async ({ page }) => {
    await open(page, width);
    for (const { id } of ROWS) {
      const record = page.getByTestId(`provider-${id}`);
      await expect(record.getByLabel("Date last confirmed")).toBeHidden();
      await page.getByTestId(`provider-${id}-change`).click();
      const [line, label, date, save] = await Promise.all([
        box(page.getByTestId(`provider-${id}-change`)),
        box(record.locator(".provider-row__label")),
        box(record.getByLabel("Date last confirmed")),
        box(record.getByRole("button", { name: "Save date" })),
      ]);
      expect(label.top, `${id}: the label is under the badge's line`).toBeGreaterThanOrEqual(line.bottom - 0.5);
      expect(date.top, `${id}: the date is under its label`).toBeGreaterThanOrEqual(label.bottom - 0.5);
      expect(Math.abs(save.top - date.top), `${id}: Save date's top is the date's`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(save.height - date.height), `${id}: Save date is as tall as the date`).toBeLessThanOrEqual(0.5);
      expect(save.left, `${id}: Save date follows the date`).toBeGreaterThan(date.right);
      expect(Math.abs(date.left - label.left), `${id}: the field starts with its label`).toBeLessThanOrEqual(0.5);
      for (const target of [date, save]) expect(isTarget(target)).toBe(true);
      // "Today or earlier." shows only with a refusal.
      await expect(page.getByTestId(`provider-${id}-date-hint`)).toHaveCount(0);
    }
    await expectNoOverflow(page);
  });

  test(`providers at ${width}px: the actions menu opens by keyboard inside the viewport, Escape closes it and focus returns to ⋯`, async ({ page }) => {
    await open(page, width);
    // A <summary>: its name is its aria-label (its role is the browser's disclosure button, not "button" in Playwright's table).
    const button = page.getByLabel(`Actions for ${ROWS[2].name}`, { exact: true });
    const unpublish = page.getByTestId("provider-M903").getByRole("button", { name: "Unpublish" });

    await button.focus();
    await page.keyboard.press("Enter");
    await expect(unpublish).toBeVisible();
    const panel = await box(page.getByTestId("provider-M903-actions").locator(".row-actions__panel"));
    expect(panel.left, "the menu stays inside the viewport").toBeGreaterThanOrEqual(0);
    expect(panel.right).toBeLessThanOrEqual(width);
    expect(isTarget(await box(unpublish))).toBe(true);
    await expectNoOverflow(page);

    await page.keyboard.press("Tab");
    await expect(unpublish).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(unpublish).toBeHidden();
    await expect(button).toBeFocused();

    // Space opens it too; a press outside closes it.
    await page.keyboard.press(" ");
    await expect(unpublish).toBeVisible();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(unpublish).toBeHidden();
  });
}

test("the menu of a provider not confirmed holds a disabled Publish with its reason; tabbing out of a menu closes it", async ({ page }) => {
  await open(page, 390);
  await page.getByLabel("Actions for Provider M901", { exact: true }).click();
  const menu = page.getByTestId("provider-M901-actions");
  await expect(menu.getByRole("button", { name: "Publish" })).toBeDisabled();
  await expect(page.getByTestId("provider-M901-publish-hint")).toHaveText("Confirm this provider first");
  await expect(page.getByTestId("provider-M901-publish-hint")).toBeVisible();
  // The disabled item is skipped: Tab leaves the menu for the badge's line, and the menu closes.
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("provider-M901-change")).toBeFocused();
  await expect(menu.getByRole("button", { name: "Publish" })).toBeHidden();
});

test("the tabs and the search narrow the list: To confirm, Hidden, and a search that finds nothing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const texts = { ...REAL_TEXTS, heading: englishText("staff.providers.title"), paragraphs: [englishText("staff.providers.lead")] };
  const props = { texts, brand, rows: ROWS, labels: providerListLabels(), filterLabels: providerFiltersLabels(), today: "2026-10-02" };

  await mountHydrated(page, "ProvidersFixture", { ...props, query: { filter: "confirm", q: "" } }, { lang: "en" });
  await expect(page.getByTestId("provider-tab-confirm")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("provider-tab-all")).not.toHaveAttribute("aria-current");
  await expect(page.getByTestId("provider-tab-all")).toHaveText("All 4");
  await expect(page.getByTestId("provider-tab-confirm")).toHaveText("To confirm 1");
  await expect(page.getByTestId("provider-tab-hidden")).toHaveText("Hidden 2");
  await expect(page.getByTestId("provider-list").getByRole("listitem")).toHaveCount(1);

  await mountHydrated(page, "ProvidersFixture", { ...props, query: { filter: "all", q: "zzz" }, empty: englishText("staff.providers.noMatch", { q: "zzz" }) }, { lang: "en" });
  await expect(page.getByTestId("provider-list-empty")).toHaveText("No providers match “zzz”.");
  await expect(page.getByLabel("Search by name or code")).toHaveValue("zzz");
  await expect(page.getByTestId("provider-search-clear")).toHaveAttribute("href", "/staff/providers");
  await expectNoOverflow(page);
});
