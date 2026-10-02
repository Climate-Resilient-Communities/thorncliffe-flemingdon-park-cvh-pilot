import { expect, test } from "@playwright/test";
import { box, tokenPx } from "../helpers/hub-layout-boundaries";
import { mount } from "../helpers/layout-fixture";
import { tapViolations } from "../helpers/tap-check";

test.describe("tap rule", () => {
  for (const basic of [false, true]) {
    test(`makes controls at least ${basic ? "--tap-basic (56px)" : "--tap (44px)"} and keeps them --gap-target apart`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await mount(page, "TapTargets", {}, { basic });
      const tap = await tokenPx(page, basic ? "--tap-basic" : "--tap");
      const [button, link] = await Promise.all([box(page.getByTestId("icon-button")), box(page.getByTestId("link"))]);

      expect(tap).toBe(basic ? 56 : 44);
      for (const target of [button, link]) {
        expect(target.width).toBeGreaterThanOrEqual(tap);
        expect(target.height).toBeGreaterThanOrEqual(tap);
      }
      expect(link.left - button.right).toBeGreaterThanOrEqual(await tokenPx(page, "--gap-target"));
    });
  }

  test('a link in text marked data-tap-exempt="inline-text" passes the tap check; a standalone small link fails it', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await mount(page, "InlineTextLinks", {});
    const inline = await box(page.locator('[data-tap-exempt="inline-text"] a'));

    expect(inline.height, "the inline link is smaller than --tap").toBeLessThan(await tokenPx(page, "--tap"));
    const violations = await tapViolations(page);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("#standalone");
  });

  test("the tap check passes the tap-class controls and fails the same link without the exemption", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await mount(page, "TapTargets", {});
    expect(await tapViolations(page)).toEqual([]);

    await mount(page, "InlineTextLinks", {});
    await page.evaluate(() => document.querySelector("[data-tap-exempt]")!.removeAttribute("data-tap-exempt"));
    expect(await tapViolations(page)).toHaveLength(2);
  });
});
