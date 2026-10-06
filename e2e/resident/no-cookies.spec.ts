import { expect, test } from "@playwright/test";
import terms from "../../data/catalogue/terms.json";
import { ArchiveV1, FeedV1 } from "../../src/contracts/feed";
import { LANGUAGES } from "./helpers";

// S02.02, AD-3: resident routes set no cookies (next-intl runs with localeCookie: false, and Supabase
// middleware matches only /staff/** and /api/staff/**). No response under /{lang}/** carries Set-Cookie.

const PATHS = ["", "/map", "/search", "/ready", "/ready/power", "/ready/numbers", "/ready/no-such-guide", "/terms", "/text-alerts", "/buildings/123", "/directory", "/directory/P101", "/does-not-exist"];

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

// S05.08, AD-3: the share link /a/{slug}?l={lang} sets no cookie, in any language, whatever it answers (this server has no alert, so it is the 404 of an address nobody
// has an alert at; alerts.spec.ts checks the alert and the closed thread on the server that has them). It is answered where it is, never redirected.
test("no response to the share link /a/** sets a cookie, with or without a language", async ({ request }) => {
  const checked: string[] = [];
  for (const { code } of LANGUAGES) {
    for (const path of [`/a/kbcdfghj?l=${code}`, `/a/nosuchslug?l=${code}`]) {
      const response = await request.get(path, { maxRedirects: 0 });

      expect(response.status(), path).toBe(404);
      expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), path).toEqual([]);
      checked.push(path);
    }
  }
  for (const path of ["/a/kbcdfghj", "/a/kbcdfghj?l=", "/a/kbcdfghj?l=xx", "/a", "/a/kbcdfghj/more"]) {
    const response = await request.get(path, { maxRedirects: 0 });

    expect(response.status(), path).toBe(404);
    expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), path).toEqual([]);
    checked.push(path);
  }
  expect(checked).toHaveLength(LANGUAGES.length * 2 + 5);
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

// S02.11: the public feed (the same for everyone) sets no cookie either, in any language, and is a valid FeedV1 with
// no threads and every building and neighbourhood at status none while no alert can have been published (S04.08).
test("the feed sets no cookie, in any language, and is a valid FeedV1 with every place at none", async ({ request }) => {
  for (const { code } of LANGUAGES) {
    const response = await request.get(`/api/feed?lang=${code}`, { maxRedirects: 0 });

    expect(response.status(), code).toBe(200);
    expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), code).toEqual([]);
    expect(response.headers()["cache-control"], code).toBe("public, max-age=0, s-maxage=15");
    const feed = FeedV1.parse(await response.json());
    expect(feed.threads, code).toEqual([]);
    expect(feed.places.buildings.length, code).toBeGreaterThan(0);
    expect([...feed.places.buildings, ...feed.places.neighbourhoods].every((place) => place.status === "none"), code).toBe(true);
  }
});

// S05.07: the archive of closed alerts is public and the same for everyone, so it sets no cookie either, in any language, on any page of it, and is shared for at most 60 seconds.
test("the archive API and the archive screen set no cookie, in any language, and the API is a valid ArchiveV1 shared for 60 seconds", async ({ request }) => {
  for (const { code } of LANGUAGES) {
    const response = await request.get(`/api/feed/archive?lang=${code}&page=2`, { maxRedirects: 0 });

    expect(response.status(), code).toBe(200);
    expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), code).toEqual([]);
    expect(response.headers()["cache-control"], code).toBe("public, max-age=0, s-maxage=60");
    expect(ArchiveV1.parse(await response.json()), code).toMatchObject({ page: 2, threads: [] });
    const screen = await request.get(`/${code}/archive`, { maxRedirects: 0 });
    expect(screen.status(), code).toBe(200);
    expect(screen.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), code).toEqual([]);
  }
});

test("a feed request with a missing or unknown language is refused, with no cookie and no caching", async ({ request }) => {
  for (const path of ["/api/feed", "/api/feed?lang=xx"]) {
    const response = await request.get(path, { maxRedirects: 0 });

    expect(response.status(), path).toBe(400);
    expect(response.headers()["cache-control"], path).toBe("no-store");
    expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), path).toEqual([]);
  }
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

// S02.15: the usage counter takes one fixed message and nothing else, sets no cookie whatever it answers, and is never cacheable. This server has no database,
// so a valid event is told it could not be counted (503); with one it is 204 (test/db/usageCount.db.test.ts). A body that is not exactly the message is 400.
test("the usage endpoint sets no cookie and is not cacheable, for a valid event, a refused one and a request of the wrong kind", async ({ request }) => {
  const valid = { evt: "directory_view", lang: "en", nbhd: "TP" };
  const refused: unknown[] = [{ evt: "directory_view", lang: "xx" }, { evt: "page_view", lang: "en" }, { ...valid, rsn: "4154146" }, { evt: "install" }, { evt: "install", lang: "en", pad: "x".repeat(300) }];
  for (const data of [valid, ...refused]) {
    const response = await request.post("/api/metrics", { data, headers: { cookie: "sid=abc123" }, maxRedirects: 0 });

    expect(data === valid ? [204, 503] : [400], JSON.stringify(data)).toContain(response.status());
    expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), JSON.stringify(data)).toEqual([]);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
  const get = await request.get("/api/metrics", { maxRedirects: 0 });
  expect(get.status()).toBe(405);
  expect(get.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie")).toEqual([]);
});

// S07.06: the one-time web link's page (in every language) and its three POSTs set no cookie, are never cacheable and send no referrer,
// whatever they answer: a refused body, and (this server has no database) a request that cannot be answered. A GET of the API is refused.
test("the edit link's page and API set no cookie, are not cacheable and send no referrer, whatever they answer", async ({ request }) => {
  const token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
  const checks = async (response: Awaited<ReturnType<typeof request.get>>, what: string) => {
    expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), what).toEqual([]);
    expect(response.headers()["cache-control"], what).toBe("no-store");
    expect(response.headers()["referrer-policy"], what).toBe("no-referrer");
  };
  for (const { code } of LANGUAGES) {
    const response = await request.get(`/${code}/subscription/${token}`, { maxRedirects: 0 });
    expect(response.status(), code).toBe(200);
    await checks(response, code);
  }
  for (const route of ["view", "change", "delete"]) {
    for (const data of [{}, { v: 1, token }]) {
      const response = await request.post(`/api/subscription/${route}`, { data, maxRedirects: 0 });
      expect([400, 503], `${route} ${JSON.stringify(data)}`).toContain(response.status());
      await checks(response, route);
    }
    const get = await request.get(`/api/subscription/${route}`, { maxRedirects: 0 });
    expect(get.status()).toBe(405);
    await checks(get, `GET ${route}`);
  }
});

// S07.02: the sign-up POST carries a number and places (AD-3's exception) and still sets no cookie, whatever it answers: a refusal of the
// form, and (this server has no database) a sign-up that cannot be made. Never cacheable; a GET is refused.
test("the sign-up endpoint sets no cookie and is not cacheable, whether it refuses or cannot answer", async ({ request }) => {
  const valid = { v: 1, phone: "416 555 0123", lang: "en", neighbourhood: "TP", places: [], groups: [], consent_version: terms.consentVersion, terms_agreed: true, age_confirmed: true };
  for (const data of [{}, { ...valid, phone: "212 555 0123" }, { ...valid, terms_agreed: false }, valid]) {
    const response = await request.post("/api/signup", { data, maxRedirects: 0 });

    expect([400, 503], JSON.stringify(data)).toContain(response.status());
    expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), JSON.stringify(data)).toEqual([]);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
  const get = await request.get("/api/signup", { maxRedirects: 0 });
  expect(get.status()).toBe(405);
  expect(get.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie")).toEqual([]);
});

