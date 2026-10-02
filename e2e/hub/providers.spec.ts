import { expect, test, type Page } from "@playwright/test";
import { providerListLabels } from "../../src/app/staff/providers/labels";
import type { ProviderRowData } from "../../src/app/staff/providers/ProviderList";
import { englishText } from "../../src/i18n/text";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mountHydrated } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S02.04: the Providers screen in the Hub shell, in en as an Admin sees it: the list, a refusal and a done message. The
// real ProviderList renders with the buttons, input and error styles of hub-forms.css; its actions are the harness's
// stand-ins (e2e/helpers/provider-actions-stub.ts). The behaviour against a real server is e2e/staff/providers.spec.ts.
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
  row("M903", "East York Food Bank", { published: true, lastConfirmed: "2026-09-28" }),
  row("M904", "Closed Community Kitchen", { inCatalogue: false, lastConfirmed: "2026-08-15" }),
];

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  await mountHydrated(
    page,
    "ProvidersFixture",
    {
      texts,
      brand,
      rows: ROWS,
      labels: providerListLabels(),
      today: TODAY,
      summary: englishText("staff.providers.summary", { published: 1, total: 3, unconfirmed: 1 }),
    },
    { lang: "en" },
  );
}

const rowOf = (page: Page, id: string) => page.getByTestId(`provider-${id}`);

for (const width of [1280, 390]) {
  test(`providers list at ${width}px`, async ({ page }) => {
    await open(page, width);

    // The date is shown once, in its field; Publish waits for a saved date and says why.
    await expect(rowOf(page, "M901").getByRole("button", { name: "Publish" })).toBeDisabled();
    await expect(rowOf(page, "M901").getByRole("button", { name: "Save date" })).toBeEnabled();
    await expect(rowOf(page, "M902").getByRole("button", { name: "Publish" })).toBeEnabled();
    await expect(rowOf(page, "M903").getByRole("button", { name: "Unpublish" })).toBeEnabled();
    await expectBaseline(page, `providers-en-list-${width}.png`, { fullPage: true });
  });
}

test("providers refusal at 390px: a separate bold alert, with the status region still empty", async ({ page }) => {
  await open(page, 390);
  await rowOf(page, "M902").getByLabel("Date last confirmed").fill(TODAY);
  await rowOf(page, "M902").getByRole("button", { name: "Save date" }).click();

  await expect(page.getByTestId("provider-M902-error")).toHaveText("The date cannot be later than today.");
  await expect(page.getByTestId("provider-M902-error")).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("provider-M902-message")).toHaveText("");
  await expectBaseline(page, "providers-en-refusal-390.png", { fullPage: true });
});

test("providers done message at 390px: the status region fills, no alert", async ({ page }) => {
  await open(page, 390);
  await rowOf(page, "M903").getByRole("button", { name: "Unpublish" }).click();

  await expect(page.getByTestId("provider-M903-message")).toHaveText("East York Food Bank is no longer published.");
  await expect(page.getByTestId("provider-M903-error")).toHaveCount(0);
  await expectBaseline(page, "providers-en-done-390.png", { fullPage: true });
});
