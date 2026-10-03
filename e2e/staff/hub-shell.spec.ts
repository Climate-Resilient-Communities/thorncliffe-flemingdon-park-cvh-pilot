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
  // /staff/buildings/x has the shape of the public building page (/{lang}/buildings/{rsn}, S02.08), which is cached
  // publicly; under /staff it must still be no-store.
  const paths = [...staffRoutes(), "/staff/does-not-exist", "/staff/does/not/exist", "/api/staff/does-not-exist", "/staff/buildings/x"];
  const noStore = async (client: Pick<typeof request, "get">, state: string) => {
    for (const path of paths) {
      const response = await client.get(path, { maxRedirects: 0 });
      expect(response.headers()["cache-control"], `${state}: GET ${path} (${response.status()})`).toBe("no-store");
    }
    // /api/buildings/x is not a staff path (so not no-store by our rule), but it must never get the public building
    // page's shared-cache header.
    const api = await client.get("/api/buildings/x", { maxRedirects: 0 });
    expect(api.headers()["cache-control"] ?? "", `${state}: GET /api/buildings/x (${api.status()})`).not.toMatch(/public|s-maxage|stale-while-revalidate/);
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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My building");
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

    // The navigation is in the menu: the current page is announced, an unbuilt page is a disabled link, People is for
    // Admins, and the pilot's menu has no Moderation (MVP) and no "partner space" wording.
    await page.getByRole("button", { name: "Menu" }).click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu.getByRole("navigation", { name: "Hub", exact: true })).toBeVisible();
    await expect(menu.getByRole("link", { name: "My building" })).toHaveAttribute("aria-current", "page");
    // The alert screens are for the roles that write alerts (S04.05): an Ambassador's menu has neither.
    await expect(menu.getByRole("link", { name: "Compose an alert" })).toHaveCount(0);
    await expect(menu.getByRole("link", { name: "Log a disruption" })).toHaveCount(0);
    await expect(menu.getByRole("link", { name: "Check-in rounds", disabled: true })).toHaveCount(1);
    await expect(menu.getByRole("link", { name: "People" })).toHaveCount(0);
    await expect(menu.getByText("Moderation")).toHaveCount(0);
    await expect(page.getByText(/partner space/i)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("at 1280 px the same shell shows the side navigation, and a page below it announces its own item", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signInToTheHub(page, sql, "Rosa", "Medina");

    await expect(page.getByTestId("hub-side")).toBeVisible();
    await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
    await expect(page.getByTestId("hub-person")).toHaveText("Signed in as Rosa Medina, Ambassador");
    await expect(page.getByTestId("hub-side").getByRole("link", { name: "My building" })).toHaveAttribute("aria-current", "page");
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

test.describe("the name of the Hub and the font", () => {
  test("the shell's top bar and navigation say Hub, not the MVP's Hub and partner space", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInToTheHub(page, sql, "Mira", "Costa");

    await expect(page).toHaveTitle("Hub");
    await expect(page.locator(".hub-top__app")).toHaveText("Hub");
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("navigation", { name: "Hub", exact: true })).toBeVisible();
  });

  test("a staff page's stylesheets carry the Hub shell rules, which the staff layout imports and the resident layout does not", async ({ page }) => {
    const sheets: Promise<string>[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "stylesheet") sheets.push(response.text());
    });

    await page.goto("/staff/sign-in");
    await page.waitForLoadState("networkidle");

    const css = (await Promise.all(sheets)).join("\n");
    for (const rule of [".hub-shell", ".hub-drawer", ".hub-nav__item", ".hub-ico--menu"]) expect(css, rule).toContain(rule);
  });

  test("staff pages load Public Sans from the app, preload its Latin file, and declare no other font", async ({ page }) => {
    const fontFiles: string[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "font") fontFiles.push(new URL(response.url()).pathname);
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/staff/sign-in");
    await page.evaluate(() => document.fonts.ready);

    const families = (status?: string) =>
      page.evaluate((wanted) => [...new Set([...document.fonts].filter((face) => !wanted || face.status === wanted).map((face) => face.family.replaceAll(/["']/g, "")))], status);
    expect(await page.evaluate(() => document.fonts.check('16px "Public Sans"'))).toBe(true);
    expect(await families("loaded")).toEqual(["Public Sans"]);
    expect(await families()).toEqual(["Public Sans"]);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("h1")!).fontFamily)).toMatch(/^"?Public Sans"?,/);
    expect(fontFiles).toHaveLength(1);
    expect(fontFiles[0]).toMatch(/public-sans-latin-wght-normal.*\.woff2$/);
    // The Latin file is preloaded from the head, and it is the file that was used.
    const preloads = await page.locator('link[rel="preload"][as="font"]').evaluateAll((links) => links.map((link) => new URL((link as HTMLLinkElement).href).pathname));
    expect(preloads).toEqual(fontFiles);
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
