import { expect, test, type Page } from "@playwright/test";
import { STACK_GAPS } from "@/ui";
import { box, computed, tokenPx } from "../helpers/hub-layout-boundaries";
import { mount } from "../helpers/layout-fixture";

const stack = (page: Page) => page.getByTestId("stack");
const children = (page: Page) => Promise.all(["One", "Two", "Three"].map((label) => box(page.getByTestId(`child-${label}`))));

test.describe("Stack", () => {
  test('gap="icon": row-gap and the space between children are --gap-icon', async ({ page }) => {
    await mount(page, "StackFixture", { gap: "icon" });
    const gap = await tokenPx(page, "--gap-icon");
    const [one, two, three] = await children(page);

    expect(gap).toBe(10);
    expect(await computed(stack(page), "row-gap")).toBe(`${gap}px`);
    expect(two.top - one.bottom).toBeCloseTo(gap, 2);
    expect(three.top - two.bottom).toBeCloseTo(gap, 2);
  });

  test("every gap value computes to its token", async ({ page }) => {
    for (const gap of STACK_GAPS) {
      await mount(page, "StackFixture", { gap });
      expect(await computed(stack(page), "row-gap"), gap).toBe(`${await tokenPx(page, `--gap-${gap}`)}px`);
    }
  });

  test('as="ul" is a list with its items in the accessibility tree', async ({ page }) => {
    await mount(page, "StackList", {});

    await expect(page.getByRole("list")).toHaveCount(1);
    await expect(page.getByRole("list").getByRole("listitem")).toHaveCount(3);
  });

  test("keeps block positions in ur, and align=start follows the inline start", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await mount(page, "StackFixture", { align: "start" });
    const en = await children(page);
    const container = await box(stack(page));
    await mount(page, "StackFixture", { align: "start" }, { lang: "ur" });
    const ur = await children(page);
    const urContainer = await box(stack(page));

    expect(ur.map((child) => child.top)).toEqual(en.map((child) => child.top));
    for (const child of en) expect(child.left).toBeCloseTo(container.left, 0);
    for (const child of ur) expect(child.right).toBeCloseTo(urContainer.right, 0);
    expect(en[0].width).toBeLessThan(container.width);
  });

  test("has the same gap with basic mode on and off", async ({ page }) => {
    await mount(page, "StackFixture", {});
    const standard = await computed(stack(page), "row-gap");
    await mount(page, "StackFixture", {}, { basic: true });

    expect(await computed(stack(page), "row-gap")).toBe(standard);
  });
});
