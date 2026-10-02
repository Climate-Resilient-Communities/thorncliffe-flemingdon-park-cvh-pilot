import { expect, test } from "@playwright/test";
import { savedAtOf, savedChoices } from "./choices-fixture";
import { LANGUAGES, openResident } from "./helpers";

// S02.02: the language control (R-02) and the language URL.

test.describe("language control", () => {
  test("opens from the header and lists the 15 launch languages in their own names", async ({ page }) => {
    await openResident(page, "/en", 390);

    await page.getByTestId("shell-lang-button").click();

    const sheet = page.getByTestId("shell-lang-sheet");
    await expect(sheet).toBeVisible();
    const names = await sheet.locator("a[data-lang]").allTextContents();
    expect(names).toEqual(LANGUAGES.map(({ native }) => native));
    await expect(sheet.locator('a[aria-current="true"]')).toHaveText("English");
  });

  test("closes with Escape and with the close button, and returns focus to the language button", async ({ page }) => {
    await openResident(page, "/en", 390);
    const sheet = page.getByTestId("shell-lang-sheet");

    await page.getByTestId("shell-lang-button").click();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("shell-lang-button")).toBeFocused();

    await page.getByTestId("shell-lang-button").click();
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
  });

  for (const [from, to] of [
    ["en", "ur"],
    ["ur", "en"],
    ["en", "prs"],
    ["zh", "fr"],
  ]) {
    test(`choosing ${to} on ${from} reloads the same page under /${to}/ and saves the choice in device choices`, async ({ page }) => {
      await openResident(page, `/${from}?topic=heat#top`, 390);
      // Only the mark that the first-run steps were gone through (the config starts every test as a returning resident).
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cvh.choices")!))).toEqual({ v: 1, welcomed: true });

      await page.getByTestId("shell-lang-button").click();
      await Promise.all([page.waitForURL(`**/${to}?topic=heat#top`), page.getByTestId("shell-lang-sheet").locator(`a[data-lang="${to}"]`).click()]);
      await page.evaluate(() => document.fonts.ready);

      const target = LANGUAGES.find(({ code }) => code === to)!;
      await expect(page.locator("html")).toHaveAttribute("lang", target.bcp47);
      await expect(page.locator("html")).toHaveAttribute("dir", target.dir);
      expect(await savedChoices(page)).toEqual({ v: 1, welcomed: true, lang: to });
      // It is a write like any other, so it is stamped.
      expect(await savedAtOf(page)).toBeGreaterThan(Date.now() - 60_000);
    });
  }

  test("keeps the other device choices that are already saved", async ({ page }) => {
    await openResident(page, "/en", 390);
    await page.evaluate(() => localStorage.setItem("cvh.choices", JSON.stringify({ v: 1, lang: "en", welcomed: true, buildings: ["7"] })));

    await page.getByTestId("shell-lang-button").click();
    await Promise.all([page.waitForURL("**/ta"), page.getByTestId("shell-lang-sheet").locator('a[data-lang="ta"]').click()]);

    expect(await savedChoices(page)).toEqual({ v: 1, lang: "ta", welcomed: true, buildings: ["7"] });
  });

  test("still works when the phone refuses to store anything", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("blocked", "QuotaExceededError");
      };
    });
    await openResident(page, "/en", 390);

    await page.getByTestId("shell-lang-button").click();
    await Promise.all([page.waitForURL("**/fr"), page.getByTestId("shell-lang-sheet").locator('a[data-lang="fr"]').click()]);

    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  });

  test("marks the current destination in the navigation", async ({ page }) => {
    await openResident(page, "/ur", 390);

    await expect(page.getByTestId("shell-nav-now")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("shell-nav-map")).not.toHaveAttribute("aria-current", "page");
  });
});

test.describe("language URL", () => {
  for (const [from, to] of [
    ["/xx", "/en"],
    ["/xx/", "/en"],
    ["/zz?a=1", "/en?a=1"],
    ["/zh-Hant", "/zh"],
    ["/zh-Hant/ready", "/zh/ready"],
    ["/EN", "/en"],
    ["/xx/map", "/en/map"],
    ["/fra/buildings/123?floor=2", "/en/buildings/123?floor=2"],
  ]) {
    test(`redirects ${from} to ${to}`, async ({ request, page, baseURL }) => {
      const redirect = await request.get(from, { maxRedirects: 0 });
      expect([307, 308]).toContain(redirect.status());

      await page.goto(from);
      expect(page.url()).toBe(`${baseURL}${to}`);
    });
  }

  test("a known language opens without a redirect", async ({ request }) => {
    for (const { code } of LANGUAGES) {
      const response = await request.get(`/${code}`, { maxRedirects: 0 });

      expect(response.status(), code).toBe(200);
    }
  });
});
