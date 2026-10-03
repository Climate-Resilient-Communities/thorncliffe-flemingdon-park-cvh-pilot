import { expect, test } from "@playwright/test";
import { catalogText, isFallback, LANGUAGES, openResident } from "./helpers";

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
    await expect(page.locator("main h1")).toHaveText(catalogText(language.code, "shell.pageNotFound"));
    expect(await page.locator("body").innerText()).not.toMatch(/^404/m);
  });
}

test("the 404 of a right-to-left language is in that language and direction, with no English marking", async ({ page }) => {
  await openResident(page, "/ur/map", 390);

  // Urdu has these strings, so the heading and its line are Urdu, right to left. (How a string a language lacks is shown,
  // as a left-to-right English block inside a right-to-left page, is fallback.spec.ts.)
  const heading = catalogText("ur", "shell.pageNotFound");
  const body = catalogText("ur", "shell.pageNotFoundBody");
  expect(isFallback(heading), "the Urdu 404 heading is translated").toBe(false);
  expect(isFallback(body), "the Urdu 404 line is translated").toBe(false);
  await expect(page.locator("main h1")).toHaveText(heading);
  await expect(page.locator("main h1 + p")).toHaveText(body);
  for (const selector of ["main h1", "main h1 + p"]) {
    const run = page.locator(selector);
    await expect(run, selector).not.toHaveAttribute("lang", "en");
    expect(await run.evaluate((element) => getComputedStyle(element).direction), selector).toBe("rtl");
  }
  await expect(page.locator("main bdi, main [lang=en]")).toHaveCount(0);
  await expect(page.getByTestId("shell-nav-map")).toContainText(catalogText("ur", "shell.nav.map"));
});

test("English has no [EN] marker on its 404", async ({ page }) => {
  await openResident(page, "/en/ready/anything/deeper?x=1", 390);

  await expect(page.locator("main h1")).toHaveText(catalogText("en", "shell.pageNotFound"));
  await expect(page.locator("main bdi, main [lang=en]")).toHaveCount(0);
});

test("a navigation link that has no page yet leads to the 404 in the same shell, with that link current", async ({ page }) => {
  await openResident(page, "/ur", 390);

  await page.getByTestId("shell-nav-map").click();
  await page.waitForURL("**/ur/map");

  await expect(page.locator("main h1")).toHaveText(catalogText("ur", "shell.pageNotFound"));
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
