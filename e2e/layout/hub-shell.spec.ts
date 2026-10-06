import { expect, test, type Page } from "@playwright/test";
import { box, computed, hubPage, tokenPx } from "../helpers/hub-layout-boundaries";
import {
  HUB_BREAKPOINT,
  LANGUAGES,
  REAL_TEXTS,
  drawer,
  expectInsideViewport,
  expectShellDoesNotOverflow,
  hubBrand,
  longestTexts,
  menuButton,
  sideNav,
  topBar,
  topBarMinimum,
} from "../helpers/hub-shell";
import { mountHydrated } from "../helpers/layout-fixture";

const brand = hubBrand();
type Props = Parameters<typeof mountHydrated<"HubShellFixture">>[2];
const open = (page: Page, props: Partial<Props> & Pick<Props, "texts">, lang = "en") =>
  mountHydrated(page, "HubShellFixture", { brand, ...props }, { lang });

/** Visible controls (buttons and links) smaller than the tap rule in either dimension. */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const minimum = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tap-current"));
    return [...document.querySelectorAll<HTMLElement>("a[href], button")]
      .filter((element) => element.checkVisibility())
      .filter((element) => {
        const { width, height } = element.getBoundingClientRect();
        return width < minimum || height < minimum;
      })
      .map((element) => element.outerHTML.slice(0, 70));
  });
}

test.describe("at the Hub breakpoint, 699 and 700 px", () => {
  for (const { lang, dir } of LANGUAGES) {
    for (const [name, texts] of [
      ["real labels", REAL_TEXTS],
      ["the longest translated labels", longestTexts(lang)],
    ] as const) {
      test(`${lang}, ${name}: below it no side navigation, the menu button and the narrow inset; from it the side navigation and the wide inset`, async ({
        page,
      }) => {
        for (const width of [HUB_BREAKPOINT - 1, HUB_BREAKPOINT]) {
          await page.setViewportSize({ width, height: 800 });
          await open(page, { texts }, lang);
          await expect(page.locator("html")).toHaveAttribute("dir", dir);
          const wide = width >= HUB_BREAKPOINT;
          const inset = await tokenPx(page, wide ? "--inset-page-staff" : "--inset-page-staff-narrow");

          // The side navigation: not displayed (so not in the accessibility tree) below, 240 px beside the main from the breakpoint.
          if (wide) {
            await expect(sideNav(page)).toBeVisible();
            expect((await box(sideNav(page))).width, `side navigation at ${width}px`).toBe(await tokenPx(page, "--size-side-nav"));
            await expect(menuButton(page)).toBeHidden();
          } else {
            await expect(sideNav(page)).toBeHidden();
            expect(await computed(sideNav(page), "display")).toBe("none");
            await expect(menuButton(page)).toBeVisible();
          }
          // The side navigation is at the inline start edge.
          if (wide) {
            const side = await box(sideNav(page));
            if (dir === "ltr") expect(side.left).toBe(0);
            else expect(side.right).toBe(width);
          }

          // The page inset switches at the same width.
          for (const side of ["padding-inline-start", "padding-inline-end", "padding-block-start"]) {
            expect(parseFloat(await computed(hubPage(page), side)), `${side} at ${width}px`).toBe(inset);
          }

          // The top bar keeps its minimum and, with long labels, grows beyond it.
          const minimum = await topBarMinimum(page);
          const height = (await box(topBar(page))).height;
          expect(minimum).toBe(60);
          expect(height, `top bar at ${width}px`).toBeGreaterThanOrEqual(minimum);
          if (texts !== REAL_TEXTS) expect(height, "grows with the labels").toBeGreaterThan(minimum);

          await expectShellDoesNotOverflow(page);
          await expectInsideViewport(page, [page.getByTestId("hub-person"), page.getByTestId("hub-sign-out").getByRole("button")]);
        }
      });
    }
  }

  test("the top bar is exactly its minimum height when the labels are short", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, { texts: REAL_TEXTS });

    expect((await box(topBar(page))).height).toBe(await topBarMinimum(page));
  });
});

test.describe("at 390 px", () => {
  for (const { lang } of LANGUAGES) {
    test(`${lang}: navigation, the person and role, and sign-out are reachable without scrolling sideways, with 44 px targets`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, { texts: lang === "en" ? REAL_TEXTS : longestTexts(lang) }, lang);

      await expectShellDoesNotOverflow(page);
      await expectInsideViewport(page, [menuButton(page), page.getByTestId("hub-person"), page.getByTestId("hub-sign-out").getByRole("button")]);
      expect(await smallTargets(page)).toEqual([]);

      // The navigation is one tap away, in the drawer.
      await menuButton(page).click();
      await expect(drawer(page)).toBeVisible();
      expect(await drawer(page).evaluate((element: HTMLDialogElement) => element.matches(":modal"))).toBe(true);
      // The menu is the real one for an Admin: fourteen pages that exist (Incidents, Log a disruption, Compose an alert, Coverage, Spend, Measures, Text sign-up, People, Providers, Directory, Buildings, Pause texts, On-call numbers, and Drills) and one that is listed but not built yet.
      await expect(page.getByTestId("hub-drawer-nav").locator("a[href]")).toHaveCount(14);
      await expect(page.getByTestId("hub-drawer-nav").locator("[aria-disabled='true']")).toHaveCount(1);
      await expectInsideViewport(page, [drawer(page), page.getByTestId("hub-menu-close")]);
      expect(await smallTargets(page)).toEqual([]);
      await expectShellDoesNotOverflow(page);
    });
  }

  test("the drawer opens from the inline start edge, at the side navigation's width, in both directions", async ({ page }) => {
    for (const { lang, dir } of LANGUAGES) {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, { texts: REAL_TEXTS }, lang);
      await menuButton(page).click();
      const panel = await box(drawer(page));

      expect(panel.width).toBe(await tokenPx(page, "--size-side-nav"));
      expect(panel.height).toBe(844);
      if (dir === "ltr") expect(panel.left).toBe(0);
      else expect(panel.right).toBe(390);
    }
  });

  test("the menu closes with Escape (focus returns to the button), the close button, the backdrop and a followed link", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, { texts: REAL_TEXTS });
    await page.evaluate(() => document.addEventListener("click", (event) => event.preventDefault(), true));

    await menuButton(page).click();
    await expect(drawer(page)).toBeVisible();
    await expect(page.getByTestId("hub-menu-close")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();

    await menuButton(page).click();
    await page.getByTestId("hub-menu-close").click();
    await expect(drawer(page)).toBeHidden();

    await menuButton(page).click();
    await page.mouse.click(380, 400);
    await expect(drawer(page)).toBeHidden();

    await menuButton(page).click();
    await page.getByTestId("hub-drawer-nav").getByRole("link", { name: "People" }).click();
    await expect(drawer(page)).toBeHidden();
  });

  test("while the menu is open the page behind it does not scroll, a wheel over the backdrop included; closed, it scrolls again", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await open(page, { texts: { ...REAL_TEXTS, paragraphs: Array.from({ length: 60 }, (_, index) => `Paragraph ${index + 1}. ${REAL_TEXTS.paragraphs[0]}`) } });
    const scrollY = () => page.evaluate(() => window.scrollY);
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);

    await menuButton(page).click();
    await expect(drawer(page)).toBeVisible();
    expect(await computed(page.locator("html"), "overflow-y")).toBe("hidden");
    expect(await computed(drawer(page), "overscroll-behavior-y")).toBe("contain");
    // The backdrop is the part of the viewport beside the drawer (the drawer is 240 px wide, from the inline start).
    await page.mouse.move(340, 300);
    await page.mouse.wheel(0, 400);
    await page.mouse.wheel(0, 400);
    expect(await scrollY()).toBe(0);

    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    expect(await computed(page.locator("html"), "overflow-y")).not.toBe("hidden");
    await page.mouse.move(340, 300);
    await page.mouse.wheel(0, 400);
    await expect.poll(scrollY).toBeGreaterThan(0);
  });

  test("a menu left open when the screen turns wide is closed, not left blocking the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, { texts: REAL_TEXTS });
    await menuButton(page).click();
    await expect(drawer(page)).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });

    await expect(sideNav(page)).toBeVisible();
    // The resize event comes after the layout change.
    await expect.poll(() => drawer(page).evaluate((element: HTMLDialogElement) => element.open)).toBe(false);
    await sideNav(page).getByTestId("hub-nav-incidents").focus();
    await expect(sideNav(page).getByTestId("hub-nav-incidents")).toBeFocused();
  });
});

test.describe("at 1280 px", () => {
  for (const { lang, dir } of LANGUAGES) {
    test(`${lang}: the same shell shows the side navigation, the person and sign-out in the top bar, and no menu button`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, { texts: lang === "en" ? REAL_TEXTS : longestTexts(lang) }, lang);

      await expect(sideNav(page)).toBeVisible();
      await expect(menuButton(page)).toBeHidden();
      await expect(page.getByTestId("hub-person")).toBeVisible();
      await expect(page.getByTestId("hub-sign-out").getByRole("button")).toBeVisible();
      expect((await box(page.getByTestId("hub-main"))).left).toBeCloseTo(dir === "ltr" ? await tokenPx(page, "--size-side-nav") : 0, 0);
      // The person is at the inline end of the top bar.
      const [bar, person] = await Promise.all([box(topBar(page)), box(page.getByTestId("hub-who"))]);
      if (dir === "ltr") expect(person.right).toBeCloseTo(bar.right - (await tokenPx(page, "--inset-page-staff")), 0);
      else expect(person.left).toBeCloseTo(bar.left + (await tokenPx(page, "--inset-page-staff")), 0);
      await expectShellDoesNotOverflow(page);
      expect(await smallTargets(page)).toEqual([]);
    });
  }

  test("the one <main> holds the Screen, and the document, not the main, scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await open(page, { texts: { ...REAL_TEXTS, paragraphs: Array.from({ length: 40 }, (_, index) => `Paragraph ${index + 1}. ${REAL_TEXTS.paragraphs[0]}`) } });

    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByTestId("hub-main").locator(".layout-screen[data-surface='staff']")).toHaveCount(1);
    expect(await computed(page.getByTestId("hub-main"), "overflow-y")).toBe("visible");
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);
    // The side navigation's links stay in view while the page scrolls ...
    await page.evaluate(() => window.scrollTo(0, 300));
    expect((await box(sideNav(page).locator(".hub-side__sticky"))).top).toBe(0);
    // ... and its column (background and border) runs the full height of the page.
    const [column, page_] = await Promise.all([box(sideNav(page)), page.evaluate(() => document.documentElement.scrollHeight)]);
    expect(column.height).toBeCloseTo(page_, 0);
  });

  test("a navigation taller than the viewport scrolls inside its sticky box while the column fills the page", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 300 });
    await open(page, { texts: longestTexts("ur") }, "ur");

    const sticky = sideNav(page).locator(".hub-side__sticky");
    const metrics = await sticky.evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, viewport: window.innerHeight }));
    expect(metrics.clientHeight).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    const [column, scrollHeight] = await Promise.all([box(sideNav(page)), page.evaluate(() => document.documentElement.scrollHeight)]);
    expect(column.height).toBeCloseTo(scrollHeight, 0);
  });

  test("the shell has the staff type set: 16 px body text and the Arabic-script line height of 1.9 in ur", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, { texts: REAL_TEXTS });
    expect(await computed(page.getByTestId("hub-person"), "font-size")).toBe("16px");

    await open(page, { texts: longestTexts("ur") }, "ur");
    const person = page.getByTestId("hub-person");
    expect(parseFloat(await computed(person, "line-height")) / parseFloat(await computed(person, "font-size"))).toBeCloseTo(1.9, 1);
  });
});

test.describe("what a screen reader reads", () => {
  test("every control has an accessible name, and the navigation and the images are named", async ({ page }) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await open(page, { texts: REAL_TEXTS });
      if (width < HUB_BREAKPOINT) await menuButton(page).click();

      const controls = page.locator("a[href], button");
      const count = await controls.count();
      expect(count).toBeGreaterThan(0);
      for (let index = 0; index < count; index += 1) {
        const control = controls.nth(index);
        if (!(await control.isVisible())) continue;
        await expect(control, `control ${index + 1} at ${width}px`).not.toHaveAccessibleName("");
      }
      // One navigation is on screen at a time, and it has a name.
      await expect(page.getByRole("navigation", { name: REAL_TEXTS.appName })).toHaveCount(1);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("img", { name: REAL_TEXTS.logoAlt })).toHaveCount(1);
    }
  });

  test("the menu button is named Menu, announces a dialog, and the drawer is a dialog named Menu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, { texts: REAL_TEXTS });

    await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-haspopup", "dialog");
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
  });

  test("the current page is announced with aria-current=page on exactly one link, and an unbuilt page is a disabled link", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const [path, current] of [
      ["/staff", "Incidents"],
      ["/staff/people", "People"],
      ["/staff/people/", "People"],
      ["/staff/people/new", "People"],
      ["/staff/providers", "Providers"],
      ["/staff/directory", "Directory"],
      ["/staff/buildings", "Buildings"],
      ["/staff/texts", "Pause texts"],
      ["/staff/coverage", "Coverage"],
      ["/staff/spend", "Spend"],
      ["/staff/measures", "Measures"],
      ["/staff/text-signup", "Text sign-up"],
      ["/staff/alerts/log", "Log a disruption"],
      ["/staff/alerts/compose", "Compose an alert"],
      ["/staff/alerts/compose/", "Compose an alert"],
    ] as const) {
      await open(page, { texts: REAL_TEXTS, current: path });

      const links = page.getByTestId("hub-side").locator("a[href]");
      await expect(links).toHaveCount(14);
      await expect(page.locator("[aria-current]")).toHaveCount(2); // the side navigation's and the drawer's copy of it
      await expect(page.getByTestId("hub-side").locator("[aria-current='page']")).toHaveText(current);
      await expect(page.getByTestId("hub-side").getByRole("link", { name: current })).toHaveAttribute("aria-current", "page");
    }
    // The home is current only for its own path, not for every page below /staff.
    await open(page, { texts: REAL_TEXTS, current: "/staff/people" });
    await expect(page.getByTestId("hub-side").getByRole("link", { name: "Incidents" })).not.toHaveAttribute("aria-current", "page");
    // An unbuilt page is never current, whatever the path.
    await expect(sideNav(page).getByTestId("hub-nav-rounds")).not.toHaveAttribute("aria-current", /./);
    // A path outside every item: none current.
    await open(page, { texts: REAL_TEXTS, current: "/staff/elsewhere" });
    await expect(page.locator("[aria-current]")).toHaveCount(0);
  });

  test("an unbuilt page is listed as a disabled link: announced as unavailable, with no href and no tab stop, and the same size as a page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, { texts: REAL_TEXTS });

    for (const [id, name] of [["rounds", "Check-in rounds"]] as const) {
      const item = sideNav(page).getByTestId(`hub-nav-${id}`);
      await expect(item).toHaveText(name);
      await expect(item).toHaveAttribute("role", "link");
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await expect(item).not.toHaveAttribute("href", /./);
      await expect(item).not.toHaveAttribute("tabindex", /./);
      // The accessibility tree has it as a disabled link; the built pages are enabled links.
      await expect(sideNav(page).getByRole("link", { name, disabled: true })).toHaveCount(1);
      await expect(sideNav(page).getByRole("link", { name, disabled: false })).toHaveCount(0);
    }
    for (const name of ["Incidents", "Log a disruption", "Compose an alert", "Coverage", "Spend", "Measures", "People", "Directory", "Buildings"]) await expect(sideNav(page).getByRole("link", { name, disabled: false })).toHaveCount(1);

    // Tab visits the pages and passes over the unbuilt ones.
    await sideNav(page).getByTestId("hub-nav-incidents").focus();
    await page.keyboard.press("Tab");
    await expect(sideNav(page).getByTestId("hub-nav-log")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(sideNav(page).getByTestId("hub-nav-compose")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(sideNav(page).getByTestId("hub-nav-coverage")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(sideNav(page).getByTestId("hub-nav-spend")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(sideNav(page).getByTestId("hub-nav-measures")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(sideNav(page).getByTestId("hub-nav-text-signup")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(sideNav(page).getByTestId("hub-nav-people")).toBeFocused();
    await sideNav(page).getByTestId("hub-nav-rounds").focus();
    await expect(sideNav(page).getByTestId("hub-nav-rounds")).not.toBeFocused();
  });

  test("every item of the menu, linked or not, is at least the tap size high and muted when it is not a page yet", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, { texts: REAL_TEXTS });
    const tap = await tokenPx(page, "--tap");

    for (const id of ["incidents", "log", "compose", "rounds", "coverage", "people", "buildings"]) {
      expect((await box(sideNav(page).getByTestId(`hub-nav-${id}`))).height, id).toBeGreaterThanOrEqual(tap);
    }
    const colour = (id: string) => computed(sideNav(page).getByTestId(`hub-nav-${id}`), "color");
    expect(await colour("rounds")).not.toBe(await colour("people"));
    expect(await colour("compose")).toBe(await colour("people"));
    expect(await computed(sideNav(page).getByTestId("hub-nav-rounds"), "font-weight")).toBe("400");
  });

  test("the person is read as one sentence with the name isolated, and sign-out is a named button", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, { texts: REAL_TEXTS });

    await expect(page.getByTestId("hub-person")).toHaveText("Signed in as Priya Sharma, Admin");
    await expect(page.getByTestId("hub-person").locator("bdi")).toHaveText("Priya Sharma");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});

test.describe("nobody signed in", () => {
  test("the shell is drawn without the person block", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, { texts: REAL_TEXTS, signedIn: false });

    await expect(page.getByTestId("hub-who")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await expect(menuButton(page)).toBeVisible();
    expect((await box(topBar(page))).height).toBe(await topBarMinimum(page));
    await expectShellDoesNotOverflow(page);
  });
});
