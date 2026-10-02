import { expect, test } from "@playwright/test";
import { box, tokenPx } from "../helpers/hub-layout-boundaries";
import { mount } from "../helpers/layout-fixture";

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
});
