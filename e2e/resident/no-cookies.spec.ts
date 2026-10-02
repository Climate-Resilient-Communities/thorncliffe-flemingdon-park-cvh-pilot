import { expect, test } from "@playwright/test";
import { LANGUAGES } from "./helpers";

// S02.02, AD-3: resident routes set no cookies (next-intl runs with localeCookie: false, and Supabase
// middleware matches only /staff/** and /api/staff/**). No response under /{lang}/** carries Set-Cookie.

const PATHS = ["", "/map", "/search", "/ready", "/terms", "/buildings/123", "/directory", "/directory/P101", "/does-not-exist"];

test("no response to a /{lang}/** page request sets a cookie", async ({ request }) => {
  const checked: string[] = [];
  for (const { code } of LANGUAGES) {
    for (const path of PATHS) {
      const response = await request.get(`/${code}${path}`, { maxRedirects: 0 });

      expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), `/${code}${path}`).toEqual([]);
      checked.push(`/${code}${path}`);
    }
  }
  expect(checked).toHaveLength(LANGUAGES.length * PATHS.length);
});

test("no redirect to /en/ sets a cookie either, and the browser ends up with none", async ({ page, request, context }) => {
  for (const path of ["/xx", "/xx/map", "/fra/buildings/1?floor=2", "/zh-Hant"]) {
    const response = await request.get(path, { maxRedirects: 0 });

    expect(response.status(), path).toBeGreaterThanOrEqual(300);
    expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), path).toEqual([]);
  }

  const cookies: string[] = [];
  page.on("response", async (response) => {
    cookies.push(...(await response.headersArray()).filter(({ name }) => name.toLowerCase() === "set-cookie").map(({ value }) => `${response.url()}: ${value}`));
  });
  for (const path of ["/en", "/ur", "/xx/map", "/prs"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  // Open the language sheet and change language, as a resident would.
  await page.goto("/en");
  await page.getByTestId("shell-lang-button").click();
  await Promise.all([page.waitForURL("**/ur"), page.getByTestId("shell-lang-sheet").locator('a[data-lang="ur"]').click()]);
  await page.waitForLoadState("networkidle");

  expect(cookies).toEqual([]);
  expect(await context.cookies()).toEqual([]);
});

// S02.03: the building list the phone keeps (public, the same for everyone) sets no cookie either, answered or not.
test("the building list sets no cookie", async ({ request }) => {
  const response = await request.get("/api/buildings", { maxRedirects: 0 });

  expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie")).toEqual([]);
});
