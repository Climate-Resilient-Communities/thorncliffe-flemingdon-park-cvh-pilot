import { expect, test } from "@playwright/test";
import { LANGUAGES, openResident } from "./helpers";

// S02.02: a path under a language that has no page yet (the navigation's other destinations, a mistyped link) is a 404
// drawn inside the resident shell, in the language of the URL, not Next's bare English page.

for (const language of LANGUAGES.filter(({ code }) => ["ur", "prs", "zh", "en", "fr"].includes(code))) {
  test(`/${language.code}/map is a 404 in the ${language.code} shell`, async ({ page }) => {
    const response = await openResident(page, `/${language.code}/map`, 390);

    expect(response!.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", language.bcp47);
    await expect(page.locator("html")).toHaveAttribute("dir", language.dir);
    await expect(page.getByTestId("shell")).toBeVisible();
    await expect(page.getByTestId("shell-header")).toBeVisible();
    await expect(page.getByTestId("shell-nav")).toBeVisible();
    await expect(page.getByTestId("shell-nav").locator("a")).toHaveCount(4);
    // Not Next's own 404 page.
    await expect(page.locator("html#__next_error__")).toHaveCount(0);
    await expect(page.locator("main h1")).toContainText("This page could not be found.");
    expect(await page.locator("body").innerText()).not.toMatch(/^404/m);
  });
}

test("the 404 of a right-to-left language shows the English fallback as an English run", async ({ page }) => {
  await openResident(page, "/ur/map", 390);

  const run = page.locator("main h1 > bdi");
  await expect(run).toHaveAttribute("lang", "en");
  await expect(run).toHaveAttribute("dir", "ltr");
  await expect(run).toHaveText("[EN] This page could not be found.");
  // Direction and the page's own words are Urdu's.
  await expect(page.getByTestId("shell-nav-map")).toContainText("نقشہ");
});

test("English has no [EN] marker on its 404", async ({ page }) => {
  await openResident(page, "/en/ready/anything/deeper?x=1", 390);

  await expect(page.locator("main h1")).toHaveText("This page could not be found.");
  await expect(page.locator("main bdi")).toHaveCount(0);
});

test("a navigation link that has no page yet leads to the 404 in the same shell, with that link current", async ({ page }) => {
  await openResident(page, "/ur", 390);

  await page.getByTestId("shell-nav-map").click();
  await page.waitForURL("**/ur/map");

  await expect(page.locator("main h1")).toContainText("This page could not be found.");
  await expect(page.locator("html")).toHaveAttribute("lang", "ur");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("shell-nav-map")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("shell-nav-now")).not.toHaveAttribute("aria-current", "page");
});

test("a 404 is never cached for a year, under a language or at an unknown first segment", async ({ request }) => {
  for (const path of ["/ur/map", "/en/does/not/exist", "/hello", "/hello/there"]) {
    const response = await request.get(path, { maxRedirects: 0 });

    expect(response.status(), path).toBe(404);
    const cache = response.headers()["cache-control"] ?? "";
    expect(cache, path).not.toMatch(/s-maxage=31536000|max-age=31536000|immutable|public/);
    expect(cache, path).toMatch(/no-store|no-cache|private/);
  }
});
