import { expect, test } from "@playwright/test";
import { LANGUAGES } from "./helpers";

// S02.02, AD-3: resident routes set no cookies (next-intl runs with localeCookie: false, and Supabase
// middleware matches only /staff/** and /api/staff/**). No response under /{lang}/** carries Set-Cookie.

const PATHS = ["", "/map", "/search", "/ready", "/ready/power", "/ready/numbers", "/ready/no-such-guide", "/terms", "/buildings/123", "/directory", "/directory/P101", "/does-not-exist"];

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
  // Not the map: its tiles come from the tile provider, another site whose cookies are not the app's (S02.07; map.spec.ts
  // checks that tile requests carry no cookie).
  for (const path of ["/en", "/ur", "/xx/ready", "/prs"]) {
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

// S03.04: a question is personal. /api/search sets no cookie, whether it answers or refuses, and is never cacheable.
test("the search endpoint sets no cookie and is not cacheable, for a question and for a refused one", async ({ request }) => {
  for (const data of [{ q: "", lang: "en" }, { q: "a question", lang: "xx" }, { q: "a question", lang: "en" }]) {
    const response = await request.post("/api/search", { data, maxRedirects: 0 });

    expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), JSON.stringify(data)).toEqual([]);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
});

// S06.04: Twilio's status callback is public (Twilio cannot sign in) and sets no cookie, whatever it answers: here the server has no Twilio
// account (SMS_MODE=log), so it is not configured and refuses; with one it would answer 403 to a request that is not signed. Never cacheable.
test("the Twilio status callback sets no cookie and is not cacheable, for a request with a signature and one without", async ({ request }) => {
  const ref = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
  const attempts: Record<string, string>[] = [{}, { "x-twilio-signature": "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" }];
  for (const headers of attempts) {
    const response = await request.post(`/api/twilio/status?ref=${ref}`, {
      form: { MessageSid: `SM${"0".repeat(32)}`, MessageStatus: "delivered" },
      headers,
      maxRedirects: 0,
    });

    expect([403, 503], JSON.stringify(headers)).toContain(response.status());
    expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), JSON.stringify(headers)).toEqual([]);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
  const get = await request.get(`/api/twilio/status?ref=${ref}`, { maxRedirects: 0 });
  expect(get.status()).toBe(405);
  expect(get.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie")).toEqual([]);
});
