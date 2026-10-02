import { expect, test, type Page } from "@playwright/test";
import type { GridTwoColumn } from "@/ui";
import {
  box,
  checkHubTwoColumnBoundaries,
  computed,
  contentWidth,
  expectNoHorizontalOverflow,
  expectOneColumn,
  expectTwoColumns,
  hubPage,
  tokenPx,
} from "../helpers/hub-layout-boundaries";
import { mount } from "../helpers/layout-fixture";
import { longestLabels } from "../helpers/strings";

const grid = (page: Page) => page.getByTestId("grid");
const cells = (page: Page) => grid(page).locator(":scope > *");

// A stand-in for the Hub shell (S01.09), test-only: the side navigation shows at the 700px breakpoint.
const SHELL_CSS = `
  .shell { display: grid; grid-template-columns: var(--size-side-nav) minmax(0, 1fr); }
  @media (width < 700px) { .shell { grid-template-columns: minmax(0, 1fr); } .shell > nav { display: none; } }
`;

test.describe("equal-column Grid", () => {
  for (const width of [320, 390, 768]) {
    test(`two equal columns with --gap-grid at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mount(page, "Tiles", {});
      const gap = await tokenPx(page, "--gap-grid");
      const [a, b, c] = await Promise.all([0, 1, 2].map((index) => box(cells(page).nth(index))));

      expect(gap).toBe(10);
      expect(b.width).toBeCloseTo(a.width, 0);
      expect(b.left - a.right).toBeCloseTo(gap, 0);
      expect(c.top - a.bottom).toBeCloseTo(gap, 0);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("collapses to one column in basic mode, with the same gap and order", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await mount(page, "Tiles", {}, { basic: true });
    const boxes = await Promise.all([0, 1, 2, 3].map((index) => box(cells(page).nth(index))));

    expect(await computed(grid(page), "row-gap")).toBe("10px");
    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index].left).toBeCloseTo(boxes[0].left, 0);
      expect(boxes[index].width).toBeCloseTo(boxes[0].width, 0);
      expect(boxes[index].top - boxes[index - 1].bottom).toBeCloseTo(10, 0);
    }
    for (const label of ["Food", "Cooling", "Health", "Money"]) {
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: label })).toBeFocused();
    }
  });

  test("is exposed as a list when rendered as ul", async ({ page }) => {
    await mount(page, "Tiles", {});

    await expect(page.getByRole("list")).toHaveCount(1);
    await expect(page.getByRole("list").getByRole("listitem")).toHaveCount(4);
  });

  test("mark buttons: three cells of at least --tap, --gap-target apart, also in basic mode", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const basic of [false, true]) {
      await mount(page, "MarkButtons", {}, { basic });
      const tap = await tokenPx(page, basic ? "--tap-basic" : "--tap");
      const boxes = await Promise.all([0, 1, 2].map((index) => box(cells(page).nth(index))));

      for (const cell of boxes) {
        expect(cell.width).toBeGreaterThanOrEqual(tap);
        expect(cell.height).toBeGreaterThanOrEqual(tap);
        expect(cell.top).toBeCloseTo(boxes[0].top, 0);
      }
      expect(boxes[1].left - boxes[0].right).toBeCloseTo(await tokenPx(page, "--gap-target"), 0);
      await expectNoHorizontalOverflow(page);
    }
  });
});

test.describe("two-column Grid in a fixture hub-page container", () => {
  const variants: { variant: GridTwoColumn; aside: number | "even"; gap: number }[] = [
    { variant: "aside", aside: 380, gap: 28 },
    { variant: "aside-compact", aside: 300, gap: 24 },
    { variant: "even", aside: "even", gap: 24 },
    { variant: "even-inner", aside: "even", gap: 10 },
  ];

  for (const { variant, aside, gap } of variants) {
    for (const lang of ["en", "ur"]) {
      test(`${variant} (${lang}): one column at 799px of content width, two at 800px`, async ({ page }) => {
        const labels = longestLabels(lang);
        await page.setViewportSize({ width: 1280, height: 800 });

        await mount(page, "TwoColumnPage", { variant, labels, width: 799 }, { lang });
        expect(await contentWidth(hubPage(page))).toBe(799);
        await expectOneColumn(grid(page));
        expect((await box(page.getByTestId("aside"))).width).toBe(799);
        expect(await computed(grid(page), "row-gap")).toBe("20px");
        await expectNoHorizontalOverflow(page, hubPage(page));

        await mount(page, "TwoColumnPage", { variant, labels, width: 800 }, { lang });
        expect(await contentWidth(hubPage(page))).toBe(800);
        await expectTwoColumns(grid(page));
        const [main, side] = await Promise.all([box(page.getByTestId("main")), box(page.getByTestId("aside"))]);
        const asideWidth = aside === "even" ? (800 - gap) / 2 : aside;
        expect(side.width).toBeCloseTo(asideWidth, 0);
        expect(main.width).toBeCloseTo(800 - gap - asideWidth, 0);
        expect(await computed(grid(page), "column-gap")).toBe(`${gap}px`);
        if (lang === "ur") expect(main.left, "main column at the right in RTL").toBeGreaterThan(side.left);
        else expect(main.left, "main column at the left").toBeLessThan(side.left);
        await expectNoHorizontalOverflow(page, hubPage(page));
      });
    }
  }

  test("follows the container, not the viewport: a 1280px viewport with a 799px container stacks", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mount(page, "TwoColumnPage", { variant: "aside", labels: longestLabels("en"), width: 799 });

    expect(await page.evaluate(() => window.innerWidth)).toBe(1280);
    await expectOneColumn(grid(page));
  });

  test("keeps the actions in Screen's actions slot in both layouts", async ({ page }) => {
    for (const width of [799, 800]) {
      await mount(page, "TwoColumnPage", { variant: "aside", labels: longestLabels("en"), width });
      await expect(page.getByRole("region", { name: "Approval" }).getByRole("button", { name: "Approve" })).toBeVisible();
      await expect(grid(page).getByRole("button")).toHaveCount(0);
    }
  });

  test("the shared boundary helper passes on a full-width staff Screen", async ({ page }) => {
    await checkHubTwoColumnBoundaries(page, {
      open: (lang) => mount(page, "TwoColumnPage", { variant: "aside", labels: longestLabels(lang) }, { lang }),
    });
  });

  test("the shared boundary helper fails when the switch is in the wrong place", async ({ page }) => {
    const wrongSwitch = `@container hub-page (width >= 700px) {
      .layout-grid[data-two-column="aside"] { grid-template-columns: minmax(0, 1fr) var(--size-aside-staff); gap: var(--gap-columns-hub); }
    }`;
    const check = checkHubTwoColumnBoundaries(page, {
      open: (lang) => mount(page, "TwoColumnPage", { variant: "aside", labels: longestLabels(lang) }, { lang, frameCss: wrongSwitch }),
      languages: ["en"],
    });

    await expect(check).rejects.toThrow(/one column track/);
  });
});

test.describe("two-column Grid in the Hub shell", () => {
  for (const { variant, gap } of [
    { variant: "aside" as const, gap: 28 },
    { variant: "aside-compact" as const, gap: 24 },
  ]) {
    for (const lang of ["en", "ur"]) {
      test(`${variant} (${lang}): one column at 699, 700 and 1087px, two at 1088px`, async ({ page }) => {
        for (const width of [699, 700, 1087, 1088]) {
          await page.setViewportSize({ width, height: 800 });
          await mount(page, "ShellPage", { variant, labels: longestLabels(lang) }, { lang, frameCss: SHELL_CSS });
          if (width < 1088) {
            expect(await contentWidth(hubPage(page))).toBeLessThan(800);
            await expectOneColumn(grid(page));
          } else {
            expect(await contentWidth(hubPage(page))).toBe(800);
            await expectTwoColumns(grid(page));
            expect(await computed(grid(page), "column-gap")).toBe(`${gap}px`);
          }
          await expect(page.getByRole("region", { name: "Approval" }).getByRole("button")).toBeVisible();
          await expectNoHorizontalOverflow(page, hubPage(page));
        }
      });
    }
  }

  test("the shared boundary helper passes with the side navigation shown", async ({ page }) => {
    await checkHubTwoColumnBoundaries(page, {
      open: (lang) => mount(page, "ShellPage", { variant: "aside-compact", labels: longestLabels(lang) }, { lang, frameCss: SHELL_CSS }),
    });
  });
});
