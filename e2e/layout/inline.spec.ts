import { expect, test, type Page } from "@playwright/test";
import { box, computed, expectNoHorizontalOverflow, tokenPx } from "../helpers/hub-layout-boundaries";
import { mount } from "../helpers/layout-fixture";
import { longestLabels, prototypeStrings } from "../helpers/strings";

const inline = (page: Page) => page.getByTestId("inline");

test.describe("Inline", () => {
  test('gap="icon": the label starts --gap-icon after the icon in en', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await mount(page, "IconLabel", {});
    const [icon, label, row] = await Promise.all([box(page.getByTestId("icon")), box(page.getByTestId("label")), box(inline(page))]);

    expect(await computed(inline(page), "column-gap")).toBe(`${await tokenPx(page, "--gap-icon")}px`);
    expect(icon.left).toBeCloseTo(row.left, 0);
    expect(label.left - icon.right).toBeCloseTo(10, 0);
  });

  test("mirrors in ur: the icon at the right, the label ending --gap-icon before it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await mount(page, "IconLabel", {}, { lang: "ur" });
    const [icon, label, row] = await Promise.all([box(page.getByTestId("icon")), box(page.getByTestId("label")), box(inline(page))]);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(icon.right).toBeCloseTo(row.right, 0);
    expect(icon.left - label.right).toBeCloseTo(10, 0);
  });

  test("wraps six chips of the longest labels at 320px with the gap token on both axes", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    // The longest short labels (one to three words) among the Urdu strings, as chips.
    const labels = prototypeStrings("ur")
      .filter((text) => text.split(/\s+/).length <= 3 && !text.includes("{"))
      .sort((a, b) => b.length - a.length)
      .slice(0, 6);
    await mount(page, "Chips", { labels, gap: "target" }, { lang: "ur" });
    const chips = await Promise.all(labels.map((_, index) => box(inline(page).locator("li").nth(index))));
    const gap = await tokenPx(page, "--gap-target");

    expect(new Set(chips.map((chip) => Math.round(chip.top))).size).toBeGreaterThanOrEqual(2);
    expect(await computed(inline(page), "row-gap")).toBe(`${gap}px`);
    expect(await computed(inline(page), "column-gap")).toBe(`${gap}px`);
    const rows = [...new Set(chips.map((chip) => Math.round(chip.top)))].sort((a, b) => a - b);
    const firstRow = chips.filter((chip) => Math.round(chip.top) === rows[0]);
    expect(rows[1] - Math.max(...firstRow.map((chip) => chip.bottom))).toBeCloseTo(gap, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });

  for (const lang of ["en", "ur"]) {
    test(`justify="between" puts the logo and the button at opposite ends in ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await mount(page, "Header", {}, { lang });
      const [logo, button, row] = await Promise.all([box(page.getByTestId("logo")), box(page.getByTestId("language")), box(inline(page))]);
      const [start, end] = lang === "ur" ? [row.right, row.left] : [row.left, row.right];

      expect(Math.abs((lang === "ur" ? logo.right : logo.left) - start)).toBeLessThanOrEqual(1);
      expect(Math.abs((lang === "ur" ? button.left : button.right) - end)).toBeLessThanOrEqual(1);
    });
  }

  test("Inline.Grow wraps a long title and leaves the button at full size at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await mount(page, "GrowTitle", { title: longestLabels("en").sentences[0] });
    const [title, button] = await Promise.all([box(page.getByTestId("title")), box(page.getByTestId("button"))]);
    const tap = await tokenPx(page, "--tap");

    expect(title.height).toBeGreaterThan(3 * 20);
    expect(button.width).toBeGreaterThanOrEqual(tap);
    expect(button.height).toBeGreaterThanOrEqual(tap);
    await expectNoHorizontalOverflow(page);
  });
});
