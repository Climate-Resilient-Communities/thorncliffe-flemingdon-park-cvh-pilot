import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { BUILDINGS, FLOOR, stubBuildingList } from "./choices-fixture";
import { LANGUAGES, WIDTHS, catalogText, expectBaseline, openResident } from "./helpers";

// S07.06: the one-time web link's page, /{lang}/subscription/{token}. The server behind these tests has no database, so the page's three
// POSTs (/api/subscription/view, /change, /delete) and /api/buildings are answered here; the edit link's own behaviour against a database
// is test/db/editLink.db.test.ts. The page the server sends is the same for every link and holds nothing about anyone: the choices arrive
// only through the view POST. Every number is fictional.

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
const MILEPOST = BUILDINGS[0].rsn; // Thorncliffe Park, floors 1 to 3
const DRIVE = BUILDINGS[1].rsn; // Thorncliffe Park
const OVERLEA = BUILDINGS[3].rsn; // Flemingdon Park
const path = (lang: string, token = TOKEN) => `/${lang}/subscription/${token}`;

const VIEW = {
  v: 1,
  status: "ok",
  subscription: { lang: "en", neighbourhood: "TP", places: [{ rsn: MILEPOST, floors: [FLOOR.milepost2] }], groups: ["seniors"], muted_topics: ["water"], phone_last2: "23", checkin: null },
};

type Answer = { status: number; json: unknown };
const ok = (json: unknown): Answer => ({ status: 200, json });

/** Answers the page's POSTs as told, and keeps every request each got (its body and its headers). */
async function stubEdit(page: Page, answers: { view?: Answer; change?: Answer; delete?: Answer } = {}) {
  const requests: { kind: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fallback: Record<string, Answer> = { view: ok(VIEW), change: ok({ v: 1, status: "changed" }), delete: ok({ v: 1, status: "deleted" }) };
  await page.route("**/api/subscription/*", async (route: Route, request: Request) => {
    const kind = new URL(request.url()).pathname.split("/").at(-1)!;
    requests.push({ kind, body: request.postDataJSON() as Record<string, unknown>, headers: await request.allHeaders() });
    const answer = answers[kind as keyof typeof answers] ?? fallback[kind]!;
    await route.fulfill({ status: answer.status, json: answer.json, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  });
  return requests;
}

async function openEdit(page: Page, lang = "en", width = 390, answers: Parameters<typeof stubEdit>[1] = {}) {
  await stubBuildingList(page);
  const requests = await stubEdit(page, answers);
  await openResident(page, path(lang), width);
  return requests;
}

test.describe("the page the server sends", () => {
  test("is a shell with nothing about anyone: no-store, no referrer, no cookie, kept from search, and the same for every link", async ({ request }) => {
    const first = await request.get(path("en"), { maxRedirects: 0 });
    const other = await request.get(path("en", "ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-ZyXwV"), { maxRedirects: 0 });
    for (const response of [first, other]) {
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(response.headers()["referrer-policy"]).toBe("no-referrer");
      expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie")).toEqual([]);
    }
    const html = await first.text();
    expect(html).toContain(catalogText("en", "subscriptionEdit.loading"));
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    expect(html).toMatch(/<meta name="referrer" content="no-referrer"/);
    // Nothing of a subscription (no digits of a number, no choices): the page for one link is the page for any other, its token aside.
    for (const word of ["phone_last2", "muted_topics", "Milepost"]) expect(html, word).not.toContain(word);
    const otherHtml = (await other.text()).replaceAll("ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-ZyXwV", TOKEN);
    expect(otherHtml).toBe(html);
  });

  test("opened by a link preview (no script): shows the generic page and asks the server for nothing", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const asked: string[] = [];
    page.on("request", (request) => void asked.push(new URL(request.url()).pathname));
    await page.goto(path("en"));
    await expect(page.locator("main h1")).toHaveText(catalogText("en", "subscriptionEdit.title"));
    await expect(page.getByTestId("subscription-loading")).toBeVisible();
    expect(asked.filter((p) => p.startsWith("/api/"))).toEqual([]);
    await context.close();
  });
});

test.describe("the form", () => {
  test("loads the choices with the token in a POST body only, and shows the number by its last two digits", async ({ page, context }) => {
    const requests = await openEdit(page);

    await expect(page.getByTestId("subscription-form")).toBeVisible();
    expect(requests.map((r) => [r.kind, r.body])).toEqual([["view", { v: 1, token: TOKEN }]]);
    expect(requests[0]!.headers.cookie).toBeUndefined();
    expect(requests[0]!.headers.referer).toBeUndefined();
    await expect(page.getByTestId("subscription-number")).toHaveText(catalogText("en", "subscriptionEdit.forNumber").replace("{digits}", "23"));
    await expect(page.getByTestId("subscription-lang")).toHaveValue("en");
    await expect(page.getByTestId("subscription-nbhd-TP").locator("input")).toBeChecked();
    await expect(page.getByTestId(`subscription-building-${MILEPOST}`).locator("input")).toBeChecked();
    await expect(page.getByTestId(`subscription-floor-${FLOOR.milepost2}`).locator("input")).toBeChecked();
    await expect(page.getByTestId(`subscription-floor-${FLOOR.milepost1}`).locator("input")).not.toBeChecked();
    await expect(page.getByTestId("subscription-group-seniors").locator("input")).toBeChecked();
    // The check-in group is E08's: not on this page. Fire cannot be muted: not offered.
    await expect(page.getByTestId("subscription-group-checkin")).toHaveCount(0);
    await expect(page.getByTestId("subscription-topic-fire")).toHaveCount(0);
    await expect(page.getByTestId("subscription-topic-water").locator("input")).toBeChecked();
    expect(await context.cookies()).toEqual([]);
  });

  test("sends every choice as changed, any number of buildings with floors or none, then says it is saved and the link is used", async ({ page, context }) => {
    const requests = await openEdit(page);
    await expect(page.getByTestId("subscription-form")).toBeVisible();

    await page.getByTestId("subscription-lang").selectOption("ur");
    await page.getByTestId(`subscription-floor-${FLOOR.milepost3}`).click();
    await page.getByTestId("subscription-building-search").fill("Thorncliffe Park Dr");
    await page.getByTestId(`subscription-add-${DRIVE}`).click();
    await page.getByTestId("subscription-building-search").fill("Overlea");
    await page.getByTestId(`subscription-add-${OVERLEA}`).click();
    await page.getByTestId(`subscription-floor-${FLOOR.overlea1}`).click();
    await page.getByTestId("subscription-group-families").click();
    await page.getByTestId("subscription-topic-water").click();
    await page.getByTestId("subscription-topic-winter").click();
    await page.getByTestId("subscription-nbhd-FP").click();
    await page.getByTestId("subscription-save").click();

    await expect(page.getByTestId("subscription-saved")).toBeVisible();
    expect(requests.filter((r) => r.kind === "change").map((r) => r.body)).toEqual([
      {
        v: 1,
        token: TOKEN,
        lang: "ur",
        neighbourhood: "FP",
        places: [
          { rsn: MILEPOST, floors: [FLOOR.milepost2, FLOOR.milepost3] },
          { rsn: DRIVE, floors: [] },
          { rsn: OVERLEA, floors: [FLOOR.overlea1] },
        ],
        groups: ["seniors", "families"],
        muted_topics: ["winter"],
      },
    ]);
    await expect(page.locator("main h1")).toHaveText(catalogText("en", "subscriptionEdit.savedTitle"));
    await expect(page.locator("main h1")).toBeFocused();
    await expect(page.getByTestId("subscription-outcome-0")).toHaveText(catalogText("en", "subscriptionEdit.savedBody"));
    // Nothing about the subscription is kept on the phone, and no cookie.
    expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage })))).not.toMatch(/subscription|ur"|families/);
    expect(await context.cookies()).toEqual([]);
  });

  test("shows a refusal in the page's language and keeps the form; no connection says so", async ({ page }) => {
    await openEdit(page, "ur", 390, { change: { status: 400, json: { error: { code: "place_unknown", message_key: "subscriptionEdit.error.place_unknown" } } } });
    await page.getByTestId("subscription-save").click();
    await expect(page.getByTestId("subscription-errorbox")).toHaveText(catalogText("ur", "subscriptionEdit.error.place_unknown"));
    await expect(page.getByTestId("subscription-errorbox")).toBeFocused();
    await expect(page.getByTestId("subscription-form")).toBeVisible();

    await page.unroute("**/api/subscription/*");
    await page.route("**/api/subscription/*", (route) => route.abort("internetdisconnected"));
    await page.getByTestId("subscription-save").click();
    await expect(page.getByTestId("subscription-errorbox")).toHaveText(catalogText("ur", "subscriptionEdit.error.network"));
  });

  test("deletes only once confirmed, then says so on the page alone", async ({ page }) => {
    const requests = await openEdit(page);
    await page.getByTestId("subscription-delete-ask").click();
    await expect(page.getByTestId("subscription-delete-sure")).toHaveText(catalogText("en", "subscriptionEdit.deleteSure"));
    await page.getByTestId("subscription-delete-no").click();
    await expect(page.getByTestId("subscription-delete-sure")).toHaveCount(0);
    expect(requests.map((r) => r.kind)).toEqual(["view"]);

    await page.getByTestId("subscription-delete-ask").click();
    await page.getByTestId("subscription-delete-yes").click();
    await expect(page.getByTestId("subscription-deleted")).toBeVisible();
    expect(requests.map((r) => [r.kind, r.body])).toEqual([
      ["view", { v: 1, token: TOKEN }],
      ["delete", { v: 1, token: TOKEN }],
    ]);
    await expect(page.locator("main h1")).toHaveText(catalogText("en", "subscriptionEdit.deletedTitle"));
    await expect(page.getByTestId("subscription-outcome-0")).toHaveText(catalogText("en", "subscriptionEdit.deletedBody"));
    await expect(page.getByTestId("subscription-sign-up")).toHaveAttribute("href", "/en/text-alerts");
  });

  test("sends no usage event from the page, even when the app reports it was installed here", async ({ page }) => {
    const metrics: string[] = [];
    await page.route("**/api/metrics", (route) => {
      metrics.push(route.request().postData() ?? "");
      return route.fulfill({ status: 204 });
    });
    await openEdit(page);
    await expect(page.getByTestId("subscription-form")).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    // No fixed sleep: wait for a full task after the event, then for the network to go quiet, so a send it caused would be seen.
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 0))));
    await page.waitForLoadState("networkidle");
    expect(metrics).toEqual([]);
  });
});

test.describe("an expired or used link", () => {
  test("says 'This link has expired' (a success body from the server) and how to get a new one by text", async ({ page }) => {
    const requests = await openEdit(page, "en", 390, { view: ok({ v: 1, status: "expired" }) });
    await expect(page.getByTestId("subscription-expired")).toBeVisible();
    await expect(page.locator("main h1")).toHaveText("This link has expired");
    await expect(page.getByTestId("subscription-outcome-0")).toHaveText(catalogText("en", "subscriptionEdit.expiredBody"));
    await expect(page.getByTestId("subscription-outcome-1")).toHaveText(catalogText("en", "subscriptionEdit.expiredHow"));
    await expect(page.getByTestId("subscription-call-hub")).toContainText("(416) 421-8997");
    expect(requests.map((r) => r.kind)).toEqual(["view"]);
  });

  test("says the same when the link was used meanwhile and the change comes back expired", async ({ page }) => {
    await openEdit(page, "en", 390, { change: ok({ v: 1, status: "expired" }) });
    await page.getByTestId("subscription-save").click();
    await expect(page.getByTestId("subscription-expired")).toBeVisible();
  });

  test("a token that cannot be one is not sent anywhere", async ({ page }) => {
    const requests = await stubEdit(page);
    await openResident(page, path("en", "not-a-token"), 390);
    await expect(page.getByTestId("subscription-expired")).toBeVisible();
    expect(requests).toEqual([]);
  });
});

test.describe("right to left", () => {
  test("mirrors in Urdu, while the digits and the addresses stay left-to-right runs", async ({ page }) => {
    await openEdit(page, "ur");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("subscription-number").locator("bdi")).toHaveAttribute("dir", "ltr");
    await expect(page.getByTestId(`subscription-building-${MILEPOST}`).locator("bdi").first()).toHaveAttribute("dir", "ltr");
    const edges = await page.evaluate(() => {
      const main = document.querySelector("main")!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("main h1")!);
      const text = range.getBoundingClientRect();
      return { right: main.right - text.right, left: text.left - main.left };
    });
    expect(edges.right).toBeLessThan(edges.left);
  });
});

for (const language of LANGUAGES) {
  test(`/${language.code}/subscription/{token} is the page in the ${language.code} shell, every word from its catalog, with no horizontal scrolling at 320px`, async ({ page }) => {
    await stubBuildingList(page);
    await stubEdit(page, { view: ok({ ...VIEW, subscription: { ...VIEW.subscription, lang: language.code } }) });
    const response = await openResident(page, path(language.code), 320);

    expect(response!.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", language.bcp47);
    await expect(page.locator("html")).toHaveAttribute("dir", language.dir);
    await expect(page.getByTestId("subscription-form")).toBeVisible();
    await expect(page.locator("main h1")).toHaveText(catalogText(language.code, "subscriptionEdit.title"));
    await expect(page.getByTestId("subscription-topics")).toContainText(catalogText(language.code, "subscriptionEdit.topicsTitle"));
    expect(await page.locator("main").innerText()).not.toContain("[EN]");
    const overflow = () =>
      page.evaluate(() => {
        const main = document.querySelector("main")!;
        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: main.scrollWidth - main.clientWidth };
      });
    expect(await overflow()).toEqual({ page: 0, main: 0 });
    await page.getByTestId("subscription-delete-ask").click();
    expect(await overflow()).toEqual({ page: 0, main: 0 });
  });
}

test.describe("baselines", () => {
  for (const lang of ["en", "ur"]) {
    for (const width of WIDTHS) {
      test(`the form in ${lang} at ${width}px`, async ({ page }) => {
        await openEdit(page, lang, width, { view: ok({ ...VIEW, subscription: { ...VIEW.subscription, lang } }) });
        await expect(page.getByTestId(`subscription-floor-${FLOOR.milepost2}`).locator("input")).toBeChecked();
        await expectBaseline(page, `subscription-form-${lang}-${width}.png`);
      });
    }
    for (const outcome of ["expired", "saved", "deleted"] as const) {
      test(`the ${outcome} page in ${lang} at 390px`, async ({ page }) => {
        if (outcome === "expired") await openEdit(page, lang, 390, { view: ok({ v: 1, status: "expired" }) });
        else {
          await openEdit(page, lang, 390);
          if (outcome === "saved") await page.getByTestId("subscription-save").click();
          else {
            await page.getByTestId("subscription-delete-ask").click();
            await page.getByTestId("subscription-delete-yes").click();
          }
        }
        await expect(page.getByTestId(`subscription-${outcome}`)).toBeVisible();
        await expectBaseline(page, `subscription-${outcome}-${lang}-390.png`);
      });
    }
  }
});
