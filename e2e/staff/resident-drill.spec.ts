// Drills reach no resident (S04.08, AD-6), end to end against the production build with a real database (playwright.staff.config.ts): a drill
// thread inserted DIRECTLY in the database, with an approved, web-published entry and a translation in every language, as complete as a real
// alert, and then EVERY resident route and API is requested: the feed in every language, home (the server render and the page the phone draws),
// the alert detail and what "verified" means at the drill's own address, the building page of the building the drill covers, and every other
// page and API a resident can reach, enumerated from the app's folders so a route added later is covered with nothing to remember. The drill
// appears nowhere: not its words, its slug, its ids, in a body, a header or a link. A real alert beside it is the control: it is found, so the
// test would notice if the pages simply showed nothing.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { FeedV1 } from "../../src/contracts/feed";
import { LANG_CODES } from "../../src/contracts/lang";
import { openDatabase } from "./helpers";
import { newBuilding, newCoordinator, waitForFeedToList } from "./alert-flow";
import { residentRoutes } from "./resident-routes";

let sql: postgres.Sql;
let rsn: string;
let author: string;
let approver: string;
// Slugs of this run (a slug is unique), made of the 6 to 16 lowercase letters and digits the database allows.
const RUN = randomBytes(4).toString("hex");
const REAL = { slug: `real${RUN}`, text: "Power is out on floors 3 to 5. We are on it.", alertId: randomUUID(), entryId: randomUUID() };
const DRILL = { slug: `drill${RUN}`, text: "EXERCISE ONLY: a drill alert that no resident may ever read.", alertId: randomUUID(), entryId: randomUUID() };
const AUDIENCE = (building: string) => ({ scope: "buildings", buildings: [{ rsn: building, floors: null }], groups: [], types: ["power"] });
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const TRANSLATED = ["ur", "ps", "tl", "prs", "gu", "ta", "el", "sk", "bn", "hi", "pa", "zh", "es", "fr"] as const;

/** A thread and its one approved, web-published entry with a translation in every language, written directly (the lifecycle's triggers off). */
async function insertThread(thread: typeof REAL, isDrill: boolean) {
  await sql.begin(async (tx) => {
    await tx`select set_config('cvh.actor_id', ${author}, true)`;
    await tx`insert into alert (id, is_drill, reported_at, created_by, slug) values (${thread.alertId}, ${isDrill}, now() - interval '30 minutes', ${author}, ${thread.slug})`;
  });
  await sql.begin(async (tx) => {
    await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
    await tx.unsafe("alter table alert_entry_translation disable trigger alert_entry_translation_guard");
    const hash = sha(thread.entryId);
    await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until, version, content_hash, sms_bodies,
                                       submitted_at, approved_by, approved_at, approved_version, approved_hash, web_published_at)
             values (${thread.entryId}, ${thread.alertId}, 'ack', 'approved', ${author}, ${[author]}, ${thread.text}, ${["power"]}, ${tx.json(AUDIENCE(rsn))}, 'problem',
                     now() + interval '6 hours', 1, ${hash}, ${tx.json({ en: { body: "x", encoding: "gsm7", segments: 1 } })}, now(), ${approver}, now(), 1, ${hash}, now())`;
    for (const lang of TRANSLATED) {
      await tx`insert into alert_entry_translation (entry_id, lang, body, machine, model, status, source_hash)
               values (${thread.entryId}, ${lang}, ${`${thread.text} [${lang}]`}, true, 'north-small-translate-09-2026', 'translated', ${sha(thread.text)})`;
    }
    await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
    await tx.unsafe("alter table alert_entry_translation enable trigger alert_entry_translation_guard");
  });
}

test.beforeAll(async () => {
  sql = openDatabase();
  rsn = await newBuilding(sql, "77 Drill Test Dr");
  author = (await newCoordinator(sql)).id;
  approver = (await newCoordinator(sql)).id;
  await insertThread(REAL, false);
  await insertThread(DRILL, true);
});

test.afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

/** Everything that would give a drill away: its words, its slug, and its thread's and entry's ids. */
const DRILL_MARKERS = [DRILL.slug, DRILL.alertId, DRILL.entryId, "EXERCISE ONLY", "drill alert that no resident"];
const noDrill = (what: string, text: string, slugIsTheRequesters = false) => {
  for (const marker of DRILL_MARKERS.filter((candidate) => !(slugIsTheRequesters && candidate === DRILL.slug))) expect(text, `${what} must not contain ${marker}`).not.toContain(marker);
};

test("the drill is in the database as complete as an alert can be: approved, web-published, translated, and not a resident's", async () => {
  const [drill] = await sql`select a.is_drill, e.status, e.web_published_at, (select count(*)::int from alert_entry_translation t where t.entry_id = e.id) as translations
                            from alert a join alert_entry e on e.alert_id = a.id where a.id = ${DRILL.alertId}`;
  expect(drill).toMatchObject({ is_drill: true, status: "approved", translations: 14 });
  expect(drill.web_published_at).not.toBeNull();
});

test("the feed lists the real alert and never the drill, in every language, with no cookie", async ({ request }) => {
  for (const lang of LANG_CODES) await waitForFeedToList(request, lang, REAL.slug);
  for (const lang of LANG_CODES) {
    const response = await request.get(`/api/feed?lang=${lang}`, { maxRedirects: 0 });

    expect(response.status(), lang).toBe(200);
    expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"), lang).toEqual([]);
    const text = await response.text();
    noDrill(`the ${lang} feed`, text);
    const feed = FeedV1.parse(JSON.parse(text));
    // Other alerts of the run may be there (the approvals of the Hub's own tests are real alerts too); the drill never is.
    expect(feed.threads.map((thread) => thread.slug), lang).toContain(REAL.slug);
    expect(feed.threads.map((thread) => thread.slug), lang).not.toContain(DRILL.slug);
    expect(feed.threads.find((thread) => thread.slug === REAL.slug)?.entries[0].original.body, lang).toBe(REAL.text);
  }
});

test("home shows the real alert as a card and never the drill, as the server renders it and as the phone draws it", async ({ browser, baseURL, request }) => {
  await waitForFeedToList(request, "en", REAL.slug);
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [{ origin: baseURL as string, localStorage: [{ name: "cvh.choices", value: JSON.stringify({ v: 1, welcomed: true }) }] }] },
  });
  try {
    const served = await (await request.get("/en", { maxRedirects: 0 })).text();
    noDrill("the server render of home", served);

    const page = await context.newPage();
    await page.goto("/en");
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready", { timeout: 30_000 });
    await expect(page.getByTestId(`alert-card-${REAL.slug}`)).toBeVisible();
    await expect(page.getByTestId(`alert-card-${DRILL.slug}`)).toHaveCount(0);
    noDrill("home as drawn", await page.content());
    noDrill("home as read", await page.locator("body").innerText());
  } finally {
    await context.close();
  }
});

test("the alert page opens at the real alert and is a 404 with no detail at the drill's address, in every language, and so is what verified means", async ({ request }) => {
  for (const lang of ["en", "ur", "prs", "zh"]) await waitForFeedToList(request, lang, REAL.slug);
  for (const lang of ["en", "ur", "prs", "zh"]) {
    for (const suffix of ["", "/verified"]) {
      const real = await request.get(`/${lang}/alerts/${REAL.slug}${suffix}`, { maxRedirects: 0 });
      expect(real.status(), `${lang} real ${suffix}`).toBe(200);
      noDrill(`the real alert's page (${lang}${suffix})`, await real.text());

      const drill = await request.get(`/${lang}/alerts/${DRILL.slug}${suffix}`, { maxRedirects: 0 });
      expect(drill.status(), `${lang} drill ${suffix}`).toBe(404);
      expect(drill.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie")).toEqual([]);
      // The 404 is the shell's: the address in the request is all it can echo; nothing of the drill's text.
      const body = await drill.text();
      for (const marker of [DRILL.alertId, DRILL.entryId, "EXERCISE ONLY", "drill alert that no resident"]) expect(body, `404 of ${lang}${suffix}`).not.toContain(marker);
    }
  }
});

test("the building page the drill covers has nothing of it", async ({ request }) => {
  const page = await request.get(`/en/buildings/${rsn}`, { maxRedirects: 0 });

  expect(page.status()).toBe(200);
  const body = await page.text();
  expect(body).toContain("77 Drill Test Dr");
  noDrill("the building page", body);
  noDrill("the building list", await (await request.get("/api/buildings")).text());
});

test("every resident route and API, enumerated from the app, is without the drill: no body, no header, no redirect names it", async ({ request }) => {
  const routes = residentRoutes(["en", "ur"], { slug: DRILL.slug, rsn, guide: "power", id: "P101", v: "1", file: "en.json" });
  // The routes the story names are among them, and so is every API a resident can reach: the list is read from the folders, not remembered.
  const urls = routes.map((route) => route.url);
  for (const named of ["/api/feed", "/en", `/en/alerts/${DRILL.slug}`, `/en/alerts/${DRILL.slug}/verified`, `/en/buildings/${rsn}`, "/api/buildings"]) {
    expect(urls, `the enumeration includes ${named}`).toContain(named);
  }
  expect(routes.filter((route) => route.kind === "api").length).toBeGreaterThanOrEqual(4);
  expect(urls.some((url) => url.startsWith("/staff") || url.startsWith("/api/staff"))).toBe(false);

  const seen: string[] = [];
  for (const route of routes) {
    // A route that takes a query is asked the way a resident would (the feed needs a language).
    const url = route.url === "/api/feed" ? "/api/feed?lang=en" : route.url;
    const response = await request.get(url, { maxRedirects: 0 });
    const headers = response.headersArray().map(({ name, value }) => `${name}: ${value}`).join("\n");

    expect(response.status(), `${route.url} (${route.file})`).toBeLessThan(500);
    // An address that names the drill's slug is the requester's own word: the framework's own record of the route (the params in the page's
    // payload) may echo it, and that tells no one anything. Everything else about the drill is still looked for.
    const echoed = route.url.includes(DRILL.slug);
    noDrill(`headers of ${route.url}`, headers, echoed);
    noDrill(`body of ${route.url}`, await response.text(), echoed);
    seen.push(`${response.status()} ${route.url}`);
  }
  expect(seen.length).toBe(routes.length);
});

test("the real alert is what every route that tells of alerts shows, so the drill's absence is not an empty page", async ({ request }) => {
  await waitForFeedToList(request, "ur", REAL.slug);
  const detail = await (await request.get(`/en/alerts/${REAL.slug}`)).text();
  expect(detail).toContain(REAL.text);
  const feed = FeedV1.parse(await (await request.get("/api/feed?lang=ur")).json());
  expect(feed.threads.find((thread) => thread.slug === REAL.slug)?.entries[0].text.body).toContain("[ur]");
});
