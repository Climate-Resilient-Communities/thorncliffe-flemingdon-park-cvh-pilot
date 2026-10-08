import { expect, test, type Page } from "@playwright/test";
import { providerFiltersLabels, providerListLabels } from "../../src/app/staff/providers/labels";
import type { ProviderRowData } from "../../src/app/staff/providers/ProviderList";
import { englishText } from "../../src/i18n/text";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mountHydrated } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S02.04: the Providers screen in the Hub shell, in en as an Admin sees it: the filter tabs and search, the compact rows (name, status
// pill, actions menu; the verified badge's line), the date field opened by Confirm, the actions menu open, a refusal and a done message.
// The real ProviderFilters and ProviderList render with the styles of hub-forms.css and design-review.css; the list's actions are the
// harness's stand-ins (e2e/helpers/provider-actions-stub.ts). The behaviour against a real server is e2e/staff/providers.spec.ts.
const brand = hubBrand();
const HEIGHT = 844;
const TODAY = "2026-10-02";

const texts = { ...REAL_TEXTS, heading: englishText("staff.providers.title"), paragraphs: [englishText("staff.providers.lead")] };

const row = (id: string, name: string, change: Partial<ProviderRowData> = {}): ProviderRowData => ({
  id,
  name,
  detail: `${id} · Community Resilience · ${id.slice(1)} Overlea Blvd`,
  published: false,
  inCatalogue: true,
  lastConfirmed: null,
  ...change,
});

const ROWS = [
  row("M901", "Thorncliffe Neighbourhood Office"),
  row("M902", "Flemingdon Health Centre", { lastConfirmed: "2026-09-20" }),
  row("M903", "East York Food Bank", { published: true, lastConfirmed: "2026-10-02" }),
  row("M904", "Closed Community Kitchen", { inCatalogue: false, lastConfirmed: "2026-08-15" }),
];

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  await mountHydrated(page, "ProvidersFixture", { texts, brand, rows: ROWS, labels: providerListLabels(), filterLabels: providerFiltersLabels(), today: TODAY }, { lang: "en" });
}

const rowOf = (page: Page, id: string) => page.getByTestId(`provider-${id}`);
// The menu's button is a <summary> named by its aria-label.
const menuOf = (page: Page, id: string) => rowOf(page, id).getByLabel(/^Actions for /);

for (const width of [1280, 390]) {
  test(`providers list at ${width}px`, async ({ page }) => {
    await open(page, width);

    await expect(page.getByTestId("provider-tab-all")).toHaveText("All 4");
    await expect(page.getByTestId("provider-tab-confirm")).toHaveText("To confirm 1");
    await expect(page.getByTestId("provider-tab-hidden")).toHaveText("Hidden 2");
    await expect(page.getByTestId("provider-M901-status")).toHaveText("Hidden");
    await expect(page.getByTestId("provider-M901-confirmed")).toHaveText("Not confirmed");
    await expect(page.getByTestId("provider-M903-status")).toHaveText("Published");
    await expect(page.getByTestId("provider-M903-confirmed")).toHaveText("Confirmed Oct 2, 2026");
    await expect(page.getByTestId("provider-M904-status")).toHaveText("Not in catalogue");
    await expectBaseline(page, `providers-en-list-${width}.png`, { fullPage: true });
  });
}

test("providers at 390px: Confirm opens the date field of a provider not confirmed", async ({ page }) => {
  await open(page, 390);
  await page.getByTestId("provider-M901-change").click();

  await expect(rowOf(page, "M901").getByLabel("Date last confirmed")).toBeVisible();
  await expect(rowOf(page, "M901").getByRole("button", { name: "Save date" })).toBeEnabled();
  await expectBaseline(page, "providers-en-confirm-390.png", { fullPage: true });
});

test("providers at 390px: the actions menu of a provider not confirmed, Publish disabled with its reason", async ({ page }) => {
  await open(page, 390);
  await menuOf(page, "M901").click();

  await expect(rowOf(page, "M901").getByRole("button", { name: "Publish" })).toBeDisabled();
  await expect(page.getByTestId("provider-M901-publish-hint")).toBeVisible();
  await expectBaseline(page, "providers-en-menu-390.png", { fullPage: true });
});

test("providers refusal at 390px: a separate bold alert, the hint under the date, the status region still empty", async ({ page }) => {
  await open(page, 390);
  await page.getByTestId("provider-M902-change").click();
  await rowOf(page, "M902").getByLabel("Date last confirmed").fill(TODAY);
  await rowOf(page, "M902").getByRole("button", { name: "Save date" }).click();

  await expect(page.getByTestId("provider-M902-error")).toHaveText("The date cannot be later than today.");
  await expect(page.getByTestId("provider-M902-error")).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("provider-M902-date-hint")).toHaveText("Today or earlier.");
  await expect(rowOf(page, "M902").getByLabel("Date last confirmed")).toBeVisible();
  await expect(page.getByTestId("provider-M902-message")).toHaveText("");
  await expectBaseline(page, "providers-en-refusal-390.png", { fullPage: true });
});

test("providers done message at 390px: the status region fills, no alert", async ({ page }) => {
  await open(page, 390);
  await menuOf(page, "M903").click();
  await rowOf(page, "M903").getByRole("button", { name: "Unpublish" }).click();

  await expect(page.getByTestId("provider-M903-message")).toHaveText("East York Food Bank is no longer published.");
  await expect(page.getByTestId("provider-M903-error")).toHaveCount(0);
  // Sending closes the menu and gives focus back to its button.
  await expect(rowOf(page, "M903").getByRole("button", { name: "Unpublish" })).toBeHidden();
  await expect(menuOf(page, "M903")).toBeFocused();
  await expectBaseline(page, "providers-en-done-390.png", { fullPage: true });
});
