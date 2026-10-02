import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Boundary checks for Hub pages (token-architecture.md section 7, components/grid.md): the shell
 * breakpoint at 699 and 700 px of viewport, and the two-column switch at 799 and 800 px of hub-page
 * container width, in a left-to-right and a right-to-left language, with no horizontal overflow.
 *
 * Page stories call them with their page:
 *
 *   await checkHubTwoColumnBoundaries(page, { url: (lang) => `/staff/alerts/1/approve?lang=${lang}` });
 */

export const HUB_LANGUAGES = [
  { lang: "en", dir: "ltr" },
  { lang: "ur", dir: "rtl" },
] as const;

export type HubLanguage = (typeof HUB_LANGUAGES)[number]["lang"];

export type HubPageTarget = {
  /** The page's URL in each language. */
  url?: (lang: HubLanguage) => string;
  /** Or loads the page in each language some other way (a test fixture). */
  open?: (lang: HubLanguage) => Promise<void>;
  /** The two-column grid; defaults to the one in the staff Screen. */
  grid?: (page: Page) => Locator;
  languages?: readonly HubLanguage[];
};

export type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };

const SHELL_BREAKPOINT = 700;
const TWO_COLUMN_MIN = 800;

export const hubPage = (page: Page) => page.locator('.layout-screen[data-surface="staff"] > .layout-screen__body');
const defaultGrid = (page: Page) => hubPage(page).locator(".layout-grid[data-two-column]").first();

export const box = (locator: Locator): Promise<Box> =>
  locator.evaluate((element) => {
    const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
    return { left, right, top, bottom, width, height };
  });

export const computed = (locator: Locator, property: string) =>
  locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

/** A token's computed value in px, as a number (custom properties compute with their var()s resolved). */
export async function tokenPx(page: Page, token: string): Promise<number> {
  const value = await page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), token);
  expect(value, `${token} resolves to a px value`).toMatch(/^\d+(\.\d+)?px$/);
  return parseFloat(value);
}

/**
 * The width of the hub-page container's content box: what @hub-two-column: measures. It is the box's
 * fractional width minus padding and border, not clientWidth, which rounds to a whole pixel.
 */
export const contentWidth = (container: Locator) =>
  container.evaluate((element) => {
    const style = getComputedStyle(element);
    const sides = ["padding-inline-start", "padding-inline-end", "border-inline-start-width", "border-inline-end-width"];
    return element.getBoundingClientRect().width - sides.reduce((sum, side) => sum + parseFloat(style.getPropertyValue(side)), 0);
  });

/**
 * No horizontal overflow of the document, of the hub-page container, or (with `grid`) of any grid cell:
 * a cell whose text runs past its box would sit under the next column.
 */
export async function expectNoHorizontalOverflow(page: Page, container?: Locator, grid?: Locator) {
  // The cells first: they name the column that overflows.
  if (grid) {
    const cells = await grid.locator(":scope > *").evaluateAll((elements) =>
      elements.map((element, index) => ({ index, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })),
    );
    expect(cells.length, "the grid has cells").toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.scrollWidth, `grid cell ${cell.index + 1} scrollWidth <= clientWidth`).toBeLessThanOrEqual(cell.clientWidth);
    }
  }
  const root = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(root.scrollWidth, "document scrollWidth <= clientWidth").toBeLessThanOrEqual(root.clientWidth);
  if (container) {
    const own = await container.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(own.scrollWidth, "hub-page scrollWidth <= clientWidth").toBeLessThanOrEqual(own.clientWidth);
  }
}

/** Stacked: one column, main first, the aside after it at the full width, not sticky, --gap-section-hub apart. */
export async function expectOneColumn(grid: Locator) {
  const page = grid.page();
  const [main, aside] = [grid.locator(":scope > *").nth(0), grid.locator(":scope > *").nth(1)];
  const [gridBox, mainBox, asideBox] = await Promise.all([box(grid), box(main), box(aside)]);
  const gap = await tokenPx(page, "--gap-section-hub");

  expect(await computed(grid, "grid-template-columns"), "one column track").not.toContain(" ");
  expect(asideBox.top, "the aside comes after the main column").toBeGreaterThanOrEqual(mainBox.bottom);
  expect(asideBox.top - mainBox.bottom, "row gap is --gap-section-hub").toBeCloseTo(gap, 0);
  expect(asideBox.width, "the aside fills the width").toBeCloseTo(gridBox.width, 0);
  expect(mainBox.width, "the main column fills the width").toBeCloseTo(gridBox.width, 0);
  expect(await computed(aside, "position"), "the aside is not sticky").not.toBe("sticky");
}

/**
 * The aside variant's aside is sticky at the top of the viewport (inset-block-start: 0) and stays there
 * while the page scrolls; in the other variants it scrolls away with the page. Needs a page taller than the
 * viewport, with a main column longer than the aside.
 */
export async function expectAsideStickiness(grid: Locator) {
  const page = grid.page();
  const variant = (await grid.getAttribute("data-two-column")) as TwoColumnVariant;
  const aside = grid.locator(":scope > *").nth(1);
  const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(scrollable, "the page scrolls far enough to test stickiness").toBeGreaterThan(200);

  await page.evaluate(() => window.scrollTo(0, 0));
  const start = (await box(aside)).top;
  for (const scrolled of [100, 200]) {
    await page.evaluate((y) => window.scrollTo(0, y), start + scrolled);
    const top = (await box(aside)).top;
    if (VARIANTS[variant].sticky) expect(top, `the aside stays at its sticky offset after scrolling ${scrolled}px`).toBeCloseTo(0, 0);
    else expect(top, `the ${variant} aside scrolls with the page`).toBeLessThan(-scrolled / 2);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

const VARIANTS = {
  aside: { aside: "--size-aside-staff", gap: "--gap-columns-hub", sticky: true },
  "aside-compact": { aside: "--size-aside-staff-compact", gap: "--gap-panel", sticky: false },
  even: { aside: null, gap: "--gap-panel", sticky: false },
  "even-inner": { aside: null, gap: "--gap-columns-inner", sticky: false },
} as const;

export type TwoColumnVariant = keyof typeof VARIANTS;

/** Two columns: a flexible main column at the inline start, the variant's aside size and gap. */
export async function expectTwoColumns(grid: Locator) {
  const page = grid.page();
  const variant = (await grid.getAttribute("data-two-column")) as TwoColumnVariant;
  const spec = VARIANTS[variant];
  expect(spec, `known twoColumn variant "${variant}"`).toBeDefined();
  const [main, aside] = [grid.locator(":scope > *").nth(0), grid.locator(":scope > *").nth(1)];
  const [gridBox, mainBox, asideBox] = await Promise.all([box(grid), box(main), box(aside)]);
  const gap = await tokenPx(page, spec.gap);
  const rtl = (await computed(grid, "direction")) === "rtl";

  expect(asideBox.top, "main and aside side by side").toBeCloseTo(mainBox.top, 0);
  const between = rtl ? mainBox.left - asideBox.right : asideBox.left - mainBox.right;
  expect(between, `column gap is ${spec.gap}`).toBeCloseTo(gap, 0);
  if (spec.aside) {
    expect(asideBox.width, `aside is ${spec.aside}`).toBeCloseTo(await tokenPx(page, spec.aside), 0);
  } else {
    expect(asideBox.width, "two equal columns").toBeCloseTo(mainBox.width, 0);
  }
  expect(mainBox.width + gap + asideBox.width, "the columns fill the width").toBeCloseTo(gridBox.width, 0);
  expect(rtl ? mainBox.right : mainBox.left, "main column at the inline start").toBeCloseTo(rtl ? gridBox.right : gridBox.left, 0);
  const position = await computed(aside, "position");
  if (spec.sticky) expect(position, "the aside is sticky").toBe("sticky");
  else expect(position, "the aside is not sticky").not.toBe("sticky");
}

async function openPage(page: Page, target: HubPageTarget, lang: HubLanguage) {
  if (target.open) await target.open(lang);
  else if (target.url) await page.goto(target.url(lang));
  else throw new Error("Give the page's url or an open function");
  const dir = HUB_LANGUAGES.find((language) => language.lang === lang)!.dir;
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", dir);
}

/**
 * Resizes the viewport so that the hub-page content box is exactly `width` px: the Screen's own box
 * follows the viewport (minus any shell parts beside it); the body is that minus the page insets.
 */
export async function setContentWidth(page: Page, width: number) {
  const container = hubPage(page);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await contentWidth(container);
    if (Math.abs(current - width) < 0.01) return;
    const { screen, insets } = await container.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        screen: element.parentElement!.clientWidth,
        insets: parseFloat(style.paddingInlineStart) + parseFloat(style.paddingInlineEnd),
      };
    });
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    await page.setViewportSize({ width: viewport.width - screen + width + insets, height: viewport.height });
  }
  expect(await contentWidth(container), "hub-page content width (is the page's maximum inline size wide enough?)").toBeCloseTo(width, 2);
}

/**
 * The two-column switch: at 799 px of content width the page is one column, at 800 px two, in each
 * language, with no horizontal overflow (of the page, the container and every grid cell); then a 1280 px
 * viewport whose container is constrained to 799 px stacks.
 */
export async function checkHubTwoColumnBoundaries(page: Page, target: HubPageTarget) {
  const grid = target.grid ?? defaultGrid;
  for (const lang of target.languages ?? HUB_LANGUAGES.map((language) => language.lang)) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openPage(page, target, lang);
    for (const width of [TWO_COLUMN_MIN - 1, TWO_COLUMN_MIN]) {
      await setContentWidth(page, width);
      if (width < TWO_COLUMN_MIN) await expectOneColumn(grid(page));
      else await expectTwoColumns(grid(page));
      await expectNoHorizontalOverflow(page, hubPage(page), grid(page));
    }
    await expectStackedInWideViewport(page, grid);
  }
}

/**
 * A 1280px viewport whose hub-page content box is constrained to 799px: the grid follows the container,
 * not the viewport, so it is one column. A style tag fixes the Screen body's inline size (the page itself
 * is untouched), and the viewport is left at 1280px.
 */
async function expectStackedInWideViewport(page: Page, grid: (page: Page) => Locator) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addStyleTag({
    content: `.layout-screen[data-surface="staff"] > .layout-screen__body {
      box-sizing: content-box !important; inline-size: ${TWO_COLUMN_MIN - 1}px !important; max-inline-size: none !important;
    }`,
  });
  expect(await page.evaluate(() => window.innerWidth), "a 1280px viewport").toBe(1280);
  expect(await contentWidth(hubPage(page)), "hub-page content width constrained to 799px").toBe(TWO_COLUMN_MIN - 1);
  await expectOneColumn(grid(page));
  await expectNoHorizontalOverflow(page, hubPage(page), grid(page));
}

/** The shell breakpoint: the narrow page inset at a 699 px viewport, the wide one at 700 px. */
export async function checkHubShellBoundaries(page: Page, target: HubPageTarget) {
  for (const lang of target.languages ?? HUB_LANGUAGES.map((language) => language.lang)) {
    for (const width of [SHELL_BREAKPOINT - 1, SHELL_BREAKPOINT]) {
      await page.setViewportSize({ width, height: 800 });
      await openPage(page, target, lang);
      const inset = await tokenPx(page, width < SHELL_BREAKPOINT ? "--inset-page-staff-narrow" : "--inset-page-staff");
      for (const side of ["padding-inline-start", "padding-inline-end", "padding-block-start"]) {
        expect(parseFloat(await computed(hubPage(page), side)), `${side} at ${width}px`).toBe(inset);
      }
      await expectNoHorizontalOverflow(page, hubPage(page));
    }
  }
}
