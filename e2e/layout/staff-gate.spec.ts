import { expect, test, type Page } from "@playwright/test";
import { englishText } from "../../src/i18n/text";
import { box } from "../helpers/hub-layout-boundaries";
import { hubBrand } from "../helpers/hub-shell";
import { mountHydrated } from "../helpers/layout-fixture";

// The staff pages outside the Hub shell (sign-in, the authenticator code, choose a password, set up an authenticator) share one frame
// (src/app/staff/StaffAuthFrame.tsx): a header with the Hub logo, which is the link back to the resident app; the page's title and form
// below it; a quiet footer with "Terms and privacy" and "Back to the resident app" at the end. The Hub is English only, so no right-to-left.
const brand = hubBrand();
const GATES = ["sign-in", "code", "password", "authenticator"] as const;
const residentLink = englishText("staff.signIn.residentLink");
const terms = englishText("staff.journey.privacy");

async function open(page: Page, gate: (typeof GATES)[number], width: number) {
  await page.setViewportSize({ width, height: 844 });
  await mountHydrated(page, "StaffGateFixture", { page: gate, logoSrc: brand.logoSrc });
}

for (const gate of GATES) {
  for (const width of [320, 390, 1280]) {
    test(`${gate} at ${width}px: the logo alone in the header, the title below it, the footer links last, nothing overflows`, async ({ page }) => {
      await open(page, gate, width);

      // One banner with the logo link, one main, one contentinfo with the two links, in that order on the page.
      const header = page.getByRole("banner");
      const footer = page.getByRole("contentinfo");
      await expect(header).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(footer).toHaveCount(1);
      await expect(header.getByRole("link")).toHaveCount(1);
      await expect(header.getByRole("link", { name: residentLink })).toHaveAttribute("href", "/en");
      await expect(header.getByRole("img")).toHaveCount(1);
      await expect(footer.getByRole("link")).toHaveText([terms, residentLink]);
      await expect(footer.getByRole("link", { name: terms })).toHaveAttribute("href", "/en/terms");
      await expect(footer.getByRole("link", { name: residentLink })).toHaveAttribute("href", "/en");

      const [headerBox, logo, title, footerBox] = await Promise.all([box(header), box(header.getByRole("link")), box(page.locator("main h1")), box(footer)]);
      expect(title.top, "the title is below the header").toBeGreaterThanOrEqual(headerBox.bottom);
      expect(footerBox.top, "the footer is below the page").toBeGreaterThanOrEqual((await box(page.getByRole("main"))).bottom - 0.5);
      // The logo and the page's content start on one line: the header takes the page column and its inset.
      const content = await box(page.locator("main .layout-screen__body > *").first());
      expect(Math.abs(logo.left - content.left), "the logo starts where the content does").toBeLessThanOrEqual(1);
      // A short page puts the footer at the bottom of the viewport, not under the form.
      if (width === 1280) expect(Math.abs(footerBox.bottom - 844), "the footer ends at the bottom of the viewport").toBeLessThanOrEqual(1);

      // Every link and button is at least 44 px in both directions.
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("a[href], button, summary")]
          .filter((element) => element.checkVisibility())
          .filter((element) => {
            const { width, height } = element.getBoundingClientRect();
            return width < 44 || height < 44;
          })
          .map((element) => element.outerHTML.slice(0, 70)),
      );
      expect(small).toEqual([]);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "no horizontal scrolling").toBe(0);
    });
  }
}

test("sign-in: Tab goes header link, the form's fields, Sign in, Forgot your password?, then the footer's two links", async ({ page }) => {
  await open(page, "sign-in", 390);
  const expected = [
    ["link", residentLink],
    ["textbox", englishText("staff.signIn.username")],
    ["textbox", englishText("staff.signIn.password")],
    ["button", englishText("staff.signIn.submit")],
    ["summary", englishText("staff.signIn.forgot")],
    ["link", terms],
    ["link", residentLink],
  ];
  const visited: string[][] = [];
  for (let index = 0; index < expected.length + 1; index += 1) {
    await page.keyboard.press("Tab");
    visited.push(
      await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body) return ["none", ""];
        const kind = element.tagName === "A" ? "link" : element.tagName === "INPUT" ? "textbox" : element.tagName.toLowerCase();
        const name = element.getAttribute("aria-label") ?? (element.tagName === "INPUT" ? document.querySelector(`label[for="${element.id}"]`)?.textContent : element.textContent);
        return [kind, (name ?? "").trim()];
      }),
    );
  }
  // After the last footer link focus leaves the page.
  expect(visited).toEqual([...expected, ["none", ""]]);
});
