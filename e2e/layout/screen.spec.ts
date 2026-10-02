import { expect, test, type Page } from "@playwright/test";
import { box, checkHubShellBoundaries, computed, expectNoHorizontalOverflow, tokenPx } from "../helpers/hub-layout-boundaries";
import { mount, mountHydrated } from "../helpers/layout-fixture";

const body = (page: Page) => page.locator(".layout-screen__body");
const px = async (page: Page, property: string) => parseFloat(await computed(body(page), property));

async function residentInsets(page: Page) {
  return {
    inlineStart: await px(page, "padding-inline-start"),
    inlineEnd: await px(page, "padding-inline-end"),
    blockStart: await px(page, "padding-block-start"),
    blockEnd: await px(page, "padding-block-end"),
    rowGap: await px(page, "row-gap"),
  };
}

test.describe("Screen surface=\"resident\"", () => {
  for (const width of [320, 390, 768]) {
    test(`uses the resident gutter, section gap and end inset at ${width}px, uncapped`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mount(page, "ResidentScreen", {});
      const gutter = await tokenPx(page, "--gutter-resident");

      expect(await residentInsets(page)).toEqual({
        inlineStart: gutter,
        inlineEnd: gutter,
        blockStart: gutter,
        blockEnd: await tokenPx(page, "--inset-screen-end"),
        rowGap: await tokenPx(page, "--gap-section-resident"),
      });
      expect([gutter, await tokenPx(page, "--inset-screen-end"), await tokenPx(page, "--gap-section-resident")]).toEqual([16, 24, 16]);
      expect((await box(body(page))).width).toBe((await box(page.getByTestId("main"))).width);
      expect(await computed(body(page), "max-inline-size")).toBe("none");
      const [first, second] = await Promise.all([box(page.getByTestId("section-1")), box(page.getByTestId("section-2"))]);
      expect(second.top - first.bottom).toBeCloseTo(16, 0);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("keeps the same insets and gap in basic mode", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await mount(page, "ResidentScreen", {});
    const standard = await residentInsets(page);
    await mount(page, "ResidentScreen", {}, { basic: true });

    expect(await residentInsets(page)).toEqual(standard);
    expect(standard).toEqual({ inlineStart: 16, inlineEnd: 16, blockStart: 16, blockEnd: 24, rowGap: 16 });
  });

  test("mirrors in ur with the same insets and no [dir] rule", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await mount(page, "ResidentScreen", {});
    const en = { insets: await residentInsets(page), child: await box(page.getByTestId("section-2")) };
    await mount(page, "ResidentScreen", {}, { lang: "ur" });
    const ur = { insets: await residentInsets(page), child: await box(page.getByTestId("section-2")) };

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(ur.insets).toEqual(en.insets);
    expect(Math.abs(ur.child.left - (390 - en.child.right))).toBeLessThanOrEqual(1);
    expect(ur.child.top).toBe(en.child.top);
  });

  test("is not a query container", async ({ page }) => {
    await mount(page, "ResidentScreen", {});

    expect(await computed(body(page), "container-type")).toBe("normal");
    expect(await computed(body(page), "container-name")).toBe("none");
  });
});

test.describe("Screen surface=\"staff\"", () => {
  for (const [width, inset] of [
    [390, 16],
    [699, 16],
    [700, 24],
    [1280, 24],
  ] as const) {
    test(`uses the ${inset}px page inset and --gap-section-hub at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mount(page, "StaffScreen", {});
      const token = await tokenPx(page, width < 700 ? "--inset-page-staff-narrow" : "--inset-page-staff");

      expect(token).toBe(inset);
      for (const side of ["padding-inline-start", "padding-inline-end", "padding-block-start", "padding-block-end"]) {
        expect(await px(page, side), side).toBe(inset);
      }
      expect(await px(page, "row-gap")).toBe(await tokenPx(page, "--gap-section-hub"));
      expect(await px(page, "row-gap")).toBe(20);
      await expectNoHorizontalOverflow(page);
    });
  }

  for (const [width, size] of [
    ["default", 1040],
    ["review", 1080],
    ["published", 960],
    ["log", 920],
    ["update", 980],
    ["resolve", 900],
    ["partner", 1140],
  ] as const) {
    test(`width="${width}" is ${size}px, centred, at a 1600px viewport`, async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 800 });
      await mount(page, "StaffScreen", { width });
      const { left, right, width: inlineSize } = await box(body(page));

      expect(inlineSize).toBe(size);
      expect(Math.abs(left - (1600 - right))).toBeLessThanOrEqual(1);
    });
  }

  test("makes its body the hub-page query container", async ({ page }) => {
    await mount(page, "StaffScreen", {});

    expect(await computed(body(page), "container-type")).toBe("inline-size");
    expect(await computed(body(page), "container-name")).toBe("hub-page");
  });

  test("the shared shell boundary helper passes at 699 and 700px in en and ur", async ({ page }) => {
    await checkHubShellBoundaries(page, { open: (lang) => mount(page, "StaffScreen", {}, { lang }) });
  });
});

test.describe("Screen actions", () => {
  test("stay visible at the block end while the body scrolls, named by actionsLabel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await mount(page, "ActionsScreen", {});
    const actions = page.getByRole("region", { name: "Approval actions" });

    await expect(actions).toBeVisible();
    for (const scroll of [0, 400, 800]) {
      await page.evaluate((y) => window.scrollTo(0, y), scroll);
      const { bottom } = await box(actions);
      expect(bottom, `at scroll ${scroll}`).toBeCloseTo(600, 0);
    }
  });

  test("ScreenActions reserves their block size as the scroll padding once hydrated, and not before", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await mount(page, "ActionsScreen", {});
    expect(await page.evaluate(() => document.documentElement.style.scrollPaddingBlockEnd), "static markup runs no effect").toBe("");

    await mountHydrated(page, "ActionsScreen", {});
    const actions = page.getByRole("region", { name: "Approval actions" });
    const height = (await box(actions)).height;

    expect(height).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.style.scrollPaddingBlockEnd)).toBe(`${height}px`);
  });

  test("ScreenActions keeps the reserved space in step when the actions region grows", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await mountHydrated(page, "ActionsScreen", {});
    const actions = page.getByRole("region", { name: "Approval actions" });
    const before = (await box(actions)).height;
    await actions.evaluate((region) => {
      const extra = document.createElement("div");
      extra.style.blockSize = "40px";
      region.append(extra);
    });
    await expect.poll(() => page.evaluate(() => document.documentElement.style.scrollPaddingBlockEnd)).toBe(`${before + 40}px`);
  });

  test("keep the focused field above them: tabbing to the last field scrolls it clear", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    // The hydrated fixture: ScreenActions' own effect reserves the space, nothing in the test does.
    await mountHydrated(page, "ActionsScreen", {});
    const actions = page.getByRole("region", { name: "Approval actions" });
    const last = page.getByTestId("field-23");
    const height = (await box(actions)).height;

    expect(await page.evaluate(() => document.documentElement.style.scrollPaddingBlockEnd)).toBe(`${height}px`);
    // Scroll so that the last field is inside the viewport but behind the sticky actions.
    await last.evaluate((field, covered) => window.scrollBy(0, field.getBoundingClientRect().top - (window.innerHeight - covered) - 4), height);
    expect((await box(last)).bottom).toBeGreaterThan((await box(actions)).top);
    await page.getByTestId("field-22").evaluate((field) => (field as HTMLElement).focus({ preventScroll: true }));
    await page.keyboard.press("Tab");

    await expect(last).toBeFocused();
    expect((await box(last)).bottom).toBeLessThanOrEqual((await box(actions)).top);
  });
});

test.describe("Screen inset=\"none\"", () => {
  test("puts the bleed map across the full main area, with no negative margin anywhere", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await mount(page, "MapScreen", {});
    const [map, main] = await Promise.all([box(page.getByTestId("map")), box(page.getByTestId("main"))]);

    expect(map.left).toBe(main.left);
    expect(map.width).toBe(main.width);
    expect(await px(page, "padding-inline-start")).toBe(0);
    expect(await px(page, "padding-block-end")).toBe(24);
    const negative = await page.evaluate(() =>
      [...document.querySelectorAll("*")].filter((element) => {
        const style = getComputedStyle(element);
        return ["margin-top", "margin-right", "margin-bottom", "margin-left"].some((side) => parseFloat(style.getPropertyValue(side)) < 0);
      }).length,
    );
    expect(negative).toBe(0);
  });
});
