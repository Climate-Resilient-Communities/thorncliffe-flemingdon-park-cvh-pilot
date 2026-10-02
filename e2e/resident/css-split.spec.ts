import { expect, test } from "@playwright/test";

// S01.09: the Hub shell's styles belong to the staff layout (src/app/staff/staff.css), so a resident page does not
// download rules for a screen it never shows. Read from the production build's own stylesheets.
test("a resident page's stylesheets carry no Hub shell rule", async ({ page }) => {
  const sheets: Promise<string>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "stylesheet") sheets.push(response.text());
  });

  await page.goto("/en");
  await page.waitForLoadState("networkidle");

  const css = (await Promise.all(sheets)).join("\n");
  // The resident shell's own rules are there, so the check is reading the right files.
  expect(css).toContain(".layout-screen");
  expect(css).not.toMatch(/\.hub-/);
});
