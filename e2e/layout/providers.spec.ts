import { expect, test, type Page } from "@playwright/test";
import { providerListLabels } from "../../src/app/staff/providers/labels";
import type { ProviderRowData } from "../../src/app/staff/providers/ProviderList";
import { englishText } from "../../src/i18n/text";
import { box } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mountHydrated } from "../helpers/layout-fixture";

// A provider's actions (S02.04): the date field and Save date are one group, the same height on one line, with the hint under the group;
// Publish or Unpublish is a separate action that takes its own line under the hint on a phone and joins the date's line from the Hub
// breakpoint, top and height equal to it. Every target is at least 44 px.
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
const ROWS = [row("M901"), row("M902", { lastConfirmed: "2026-09-20" }), row("M903", { published: true, lastConfirmed: "2026-09-28" })];

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  const texts = { ...REAL_TEXTS, heading: englishText("staff.providers.title"), paragraphs: [englishText("staff.providers.lead")] };
  await mountHydrated(page, "ProvidersFixture", { texts, brand, rows: ROWS, labels: providerListLabels(), today: "2026-10-02", summary: "1 of 3" }, { lang: "en" });
}

for (const width of [320, 390, 1280]) {
  test(`provider actions at ${width}px: the date and Save date are one aligned group, Publish or Unpublish lines up with it or sits below`, async ({ page }) => {
    await open(page, width);
    const wide = width >= 700;
    for (const { id } of ROWS) {
      const record = page.getByTestId(`provider-${id}`);
      const [date, save, hint, action] = await Promise.all([
        box(record.getByLabel("Date last confirmed")),
        box(record.getByRole("button", { name: "Save date" })),
        box(record.getByTestId(`provider-${id}-date-hint`)),
        box(record.getByRole("button", { name: /^(Publish|Unpublish)$/ })),
      ]);
      expect(Math.abs(save.top - date.top), `${id}: Save date's top is the date's`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(save.height - date.height), `${id}: Save date is as tall as the date`).toBeLessThanOrEqual(0.5);
      expect(save.left, `${id}: Save date follows the date`).toBeGreaterThan(date.right);
      expect(hint.top, `${id}: the hint is under the group`).toBeGreaterThanOrEqual(date.bottom);
      expect(Math.abs(hint.left - date.left), `${id}: the hint starts with the group`).toBeLessThanOrEqual(0.5);
      if (wide) {
        expect(Math.abs(action.top - date.top), `${id}: the action's top is the date's`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(action.height - date.height), `${id}: the action is as tall as the date`).toBeLessThanOrEqual(0.5);
        expect(action.left, `${id}: the action follows Save date`).toBeGreaterThan(save.right);
      } else {
        expect(action.top, `${id}: the action is on its own line under the hint`).toBeGreaterThanOrEqual(hint.bottom);
        expect(Math.abs(action.left - date.left), `${id}: the action starts with the group`).toBeLessThanOrEqual(0.5);
      }
      for (const target of [date, save, action]) expect(Math.min(target.width, target.height)).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "no horizontal scrolling").toBe(0);
  });
}
