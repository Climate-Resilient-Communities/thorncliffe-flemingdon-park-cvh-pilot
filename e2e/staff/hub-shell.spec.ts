// The Hub shell in the production build (S01.09), with the identity fake (playwright.staff.config.ts): the shell around
// the Hub's own pages for someone at the Hub gate and not around the sign-in and setup pages, at 390 and 1280 px, and
// no-store on every staff page and API route. The shell's layout rules (699 and 700 px, the longest labels in en and
// ur, the drawer, names) are asserted on the component in e2e/layout/hub-shell.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import type postgres from "postgres";
import { newAmbassador, openDatabase, signInToTheHub, staffRoutes } from "./helpers";

let sql: postgres.Sql;

test.beforeAll(() => {
  sql = openDatabase();
});

test.afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

async function expectNoHorizontalScroll(page: Page) {
  const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(root.scrollWidth, "document scrollWidth <= clientWidth").toBeLessThanOrEqual(root.clientWidth);
  const container = await page.locator(".layout-screen__body").first().evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(container.scrollWidth, "page container scrollWidth <= clientWidth").toBeLessThanOrEqual(container.clientWidth);
}

test("the staff routes on disk are found, so the no-store test below covers a route the moment it exists", () => {
  expect(staffRoutes()).toEqual(
    expect.arrayContaining(["/staff", "/staff/people", "/staff/sign-in", "/staff/setup/password", "/api/staff/me", "/api/staff/sign-out", "/api/staff/sign-in"]),
  );
});

test("every staff page and API route, and a staff path that does not exist, answers with Cache-Control: no-store, signed out and signed in", async ({
  page,
  request,
}) => {
  const paths = [...staffRoutes(), "/staff/does-not-exist", "/staff/does/not/exist", "/api/staff/does-not-exist"];
  const noStore = async (client: Pick<typeof request, "get">, state: string) => {
    for (const path of paths) {
      const response = await client.get(path, { maxRedirects: 0 });
      expect(response.headers()["cache-control"], `${state}: GET ${path} (${response.status()})`).toBe("no-store");
    }
  };

  await noStore(request, "signed out");

  await signInToTheHub(page, sql, "Noor", "Haddad");
  await noStore(page.request, "signed in");
});

test.describe("signed in at the Hub gate", () => {
  test("at 390 px the menu, the person and role, and sign-out are reachable without scrolling sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInToTheHub(page, sql, "Ann", "Okafor");

    await expect(page.getByTestId("hub-shell")).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hub");
    await expect(page.getByTestId("hub-person")).toHaveText("Signed in as Ann Okafor, Ambassador");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByTestId("hub-side")).toBeHidden();
    await expectNoHorizontalScroll(page);
    for (const control of [page.getByRole("button", { name: "Menu" }), page.getByRole("button", { name: "Sign out" })]) {
      const { width, height, left, right } = await control.evaluate((element) => element.getBoundingClientRect().toJSON());
      expect(Math.min(width, height), "44 px target").toBeGreaterThanOrEqual(44);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(390);
    }

    // The navigation is in the menu: the current page is announced, an unbuilt page is plain text, People is for Admins.
    await page.getByRole("button", { name: "Menu" }).click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu.getByRole("navigation", { name: "Hub and partner space" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Incidents" })).toHaveAttribute("aria-current", "page");
    await expect(menu.getByRole("link", { name: "Compose an alert" })).toHaveCount(0);
    await expect(menu.getByText("Compose an alert")).toBeVisible();
    await expect(menu.getByRole("link", { name: "People" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("at 1280 px the same shell shows the side navigation, and a page below it announces its own item", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signInToTheHub(page, sql, "Rosa", "Medina");

    await expect(page.getByTestId("hub-side")).toBeVisible();
    await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
    await expect(page.getByTestId("hub-person")).toHaveText("Signed in as Rosa Medina, Ambassador");
    await expect(page.getByTestId("hub-side").getByRole("link", { name: "Incidents" })).toHaveAttribute("aria-current", "page");
    await expectNoHorizontalScroll(page);

    // The banner and every page sit inside the one <main> of the shell, and the person's page is inside the Screen.
    await page.goto("/staff/people");
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByTestId("hub-main").locator(".layout-screen[data-surface='staff']")).toHaveCount(1);
    await expect(page.getByTestId("hub-side").locator("[aria-current='page']")).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    // Sign out from the shell.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/staff\/sign-in$/);
  });
});

test.describe("signed out and at the setup gates", () => {
  test("the sign-in page is not inside the shell and has its one <main>", async ({ page }) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/staff/sign-in");

      await expect(page.getByTestId("hub-shell")).toHaveCount(0);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Staff sign-in");
      await expectNoHorizontalScroll(page);
    }
  });

  test("a person who has not chosen their password is held at that page, outside the shell", async ({ page }) => {
    const { username, startingPassword } = await newAmbassador(sql, "Lena", "Petrov");
    await page.goto("/staff/sign-in");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(startingPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/staff\/setup\/password$/);

    await expect(page.getByTestId("hub-shell")).toHaveCount(0);
    await expect(page.getByTestId("hub-who")).toHaveCount(0);
    await expect(page.locator("main")).toHaveCount(1);
  });
});
