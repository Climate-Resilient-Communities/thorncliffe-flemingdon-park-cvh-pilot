import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { CHECKIN_CONSENT_VERSION } from "../../src/contracts/checkin";
import { BUILDINGS, FLOOR, seedChoices, stubBuildingList } from "./choices-fixture";
import { WIDTHS, catalogText, expectBaseline, openResident } from "./helpers";

// S08.05: a check-in request. R-33 "Ask for a check-in" (/{lang}/ready/check-in): what a check-in is and is not, the 911 block, that an
// ambassador on her floor will see her number and floor, and how to ask (the sign-up form, staff help, the edit link by text); a public page
// any cache may keep. The request on the sign-up form (R-05) and on the edit page (S07.06): "where I live" among the floors the form saves,
// call or text, the consent wording to agree to, and the answer of the form's own POST (stubbed here: the server behind these tests has no
// database; the requests' behaviour against one is test/db/checkinRequest.db.test.ts). Every number is fictional.

const MILEPOST = BUILDINGS[0].rsn; // Thorncliffe Park, floors 1 to 3
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
const HUB = "(416) 421-8997";

const overflow = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector("main")!;
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: main.scrollWidth - main.clientWidth };
  });

test.describe("R-33, Ask for a check-in", () => {
  test("is a public page any cache may keep, with no cookie", async ({ request }) => {
    const response = await request.get("/en/ready/check-in", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"] ?? "").not.toContain("no-store");
    expect(response.headers()["cache-control"] ?? "").not.toContain("private");
    expect(response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie")).toEqual([]);
  });

  test("says what a check-in is and is not, the 911 block, who sees what, and leads to the sign-up and the edit link", async ({ page }) => {
    await openResident(page, "/en/ready/check-in", 390);
    await expect(page.locator("main h1")).toHaveText(catalogText("en", "R33.title"));
    await expect(page.getByTestId("checkin-page-what")).toContainText(catalogText("en", "R33.what"));
    await expect(page.getByTestId("checkin-page-what")).toContainText(catalogText("en", "R33.notEmergency"));
    // Each section is a region named by its heading.
    await expect(page.getByRole("region", { name: catalogText("en", "R33.whatTitle") })).toHaveAttribute("data-testid", "checkin-page-what");
    await expect(page.getByRole("region", { name: catalogText("en", "checkin.howTitle") })).toHaveAttribute("data-testid", "checkin-page-how");
    await expect(page.locator('[data-component="not-911"]')).toHaveCount(1);
    await expect(page.getByTestId("checkin-page-sees")).toHaveText(catalogText("en", "checkin.sees"));
    await expect(page.getByTestId("checkin-page-coverage")).toContainText(HUB);
    await expect(page.getByTestId("checkin-page-hub")).toHaveAttribute("href", "tel:+14164218997");
    await expect(page.getByTestId("checkin-page-signup")).toHaveAttribute("href", "/en/text-alerts");
    await expect(page.getByTestId("checkin-page-link-by-text")).toHaveText(catalogText("en", "subscriptionEdit.expiredHow"));
  });

  test("is reached from Be ready", async ({ page }) => {
    await openResident(page, "/en/ready", 390);
    await page.getByTestId("ready-checkin").click();
    await expect(page).toHaveURL(/\/en\/ready\/check-in$/);
  });

  for (const lang of ["en", "ur"]) {
    for (const width of WIDTHS) {
      test(`in ${lang} at ${width}px matches its baseline`, async ({ page }) => {
        await openResident(page, `/${lang}/ready/check-in`, width);
        expect(await overflow(page)).toEqual({ page: 0, main: 0 });
        await expectBaseline(page, `checkin-page-${lang}-${width}.png`);
      });
    }
  }
});

/** Answers /api/signup as told, and keeps the bodies it got. */
async function stubSignup(page: Page, json: unknown) {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/signup", async (route: Route, request: Request) => {
    bodies.push(request.postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 202, json, headers: { "Cache-Control": "no-store" } });
  });
  return bodies;
}

const choices = (value: Record<string, unknown>) => JSON.stringify({ v: 1, welcomed: true, ...value });

/** The sign-up form with Milepost's floors 1 and 2 saved and its check-in section opened. */
async function openSignupWithCheckin(page: Page, lang: string, json: unknown = { v: 1, status: "accepted", checkin: "requested" }) {
  await stubBuildingList(page);
  const bodies = await stubSignup(page, json);
  await seedChoices(page, choices({ lang, buildings: [MILEPOST], floors: [FLOOR.milepost1, FLOOR.milepost2] }));
  await openResident(page, `/${lang}/text-alerts`, 390);
  await page.getByTestId("signup-phone").fill("(416) 555-0123");
  await page.getByTestId("signup-terms-agree").click();
  await page.getByTestId("signup-age").click();
  await page.getByTestId("signup-checkin-ask").click();
  return bodies;
}

test.describe("the request on the sign-up form", () => {
  test("asks for one saved floor, call or text and the consent; sends it with the consent version, and says what became of it", async ({ page }) => {
    const bodies = await openSignupWithCheckin(page, "en", { v: 1, status: "accepted", checkin: "uncovered" });
    await expect(page.getByTestId(`signup-checkin-where-${FLOOR.milepost1}`)).toBeVisible();
    await expect(page.getByTestId(`signup-checkin-where-${FLOOR.milepost3}`)).toHaveCount(0);
    await expect(page.getByTestId("signup-checkin-consent")).toContainText(catalogText("en", "checkin.sees"));
    await expect(page.getByTestId("signup-checkin-consent").locator('[data-component="not-911"]')).toHaveCount(1);

    // Nothing is sent until the place, the method and the consent are given.
    await page.getByTestId("signup-send").click();
    await expect(page.getByTestId("signup-checkin-error-place")).toBeVisible();
    await page.getByTestId(`signup-checkin-where-${FLOOR.milepost2}`).click();
    await page.getByTestId("signup-checkin-method-text").click();
    await page.getByTestId("signup-send").click();
    await expect(page.getByTestId("signup-checkin-error-consent")).toBeVisible();
    expect(bodies).toEqual([]);

    await page.getByTestId("signup-checkin-agree").click();
    await page.getByTestId("signup-send").click();
    await expect(page.getByTestId("signup-sent")).toBeVisible();
    expect(bodies[0]!.checkin).toEqual({ rsn: MILEPOST, floor: FLOOR.milepost2, method: "text", consent_version: CHECKIN_CONSENT_VERSION });
    await expect(page.getByTestId("signup-checkin-answer")).toHaveText(catalogText("en", "checkin.uncovered").replace("{hub}", HUB));
  });

  test("sends no request when none is asked for", async ({ page }) => {
    await stubBuildingList(page);
    const bodies = await stubSignup(page, { v: 1, status: "accepted" });
    await seedChoices(page, choices({ buildings: [MILEPOST], floors: [FLOOR.milepost1] }));
    await openResident(page, "/en/text-alerts", 390);
    await page.getByTestId("signup-phone").fill("(416) 555-0123");
    await page.getByTestId("signup-terms-agree").click();
    await page.getByTestId("signup-age").click();
    await page.getByTestId("signup-send").click();
    await expect(page.getByTestId("signup-sent")).toBeVisible();
    expect(bodies[0]).not.toHaveProperty("checkin");
    await expect(page.getByTestId("signup-checkin-answer")).toHaveCount(0);
  });

  for (const lang of ["en", "ur"]) {
    test(`opened, in ${lang} at 390px, and its answer once sent`, async ({ page }) => {
      await openSignupWithCheckin(page, lang);
      await page.getByTestId(`signup-checkin-where-${FLOOR.milepost1}`).click();
      await page.getByTestId("signup-checkin-method-call").click();
      await page.getByTestId("signup-checkin").scrollIntoViewIfNeeded();
      expect(await overflow(page)).toEqual({ page: 0, main: 0 });
      await expectBaseline(page, `checkin-signup-${lang}-390.png`);
      await page.getByTestId("signup-checkin-agree").click();
      await page.getByTestId("signup-send").click();
      await expect(page.getByTestId("signup-checkin-answer")).toBeVisible();
      await expectBaseline(page, `checkin-signup-sent-${lang}-390.png`);
    });
  }
});

/** The edit page with a request held on Milepost floor 1, by call; the page's POSTs answered here. */
async function openEditWithRequest(page: Page, lang: string, change: unknown = { v: 1, status: "changed", checkin: "method_changed" }) {
  const bodies: Record<string, unknown>[] = [];
  await stubBuildingList(page);
  await page.route("**/api/subscription/*", async (route: Route, request: Request) => {
    const kind = new URL(request.url()).pathname.split("/").at(-1)!;
    bodies.push({ kind, ...(request.postDataJSON() as Record<string, unknown>) });
    const json =
      kind === "view"
        ? {
            v: 1,
            status: "ok",
            subscription: {
              lang,
              neighbourhood: "TP",
              places: [{ rsn: MILEPOST, floors: [FLOOR.milepost1, FLOOR.milepost2] }],
              groups: [],
              muted_topics: [],
              phone_last2: "23",
              checkin: { rsn: MILEPOST, floor: FLOOR.milepost1, method: "call" },
            },
          }
        : change;
    await route.fulfill({ status: 200, json, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  });
  await openResident(page, `/${lang}/subscription/${TOKEN}`, 390);
  await expect(page.getByTestId("subscription-checkin")).toBeVisible();
  return bodies;
}

test.describe("the request on the edit page", () => {
  test("shows the request held; its method alone changes with no consent asked; the answer says so", async ({ page }) => {
    const bodies = await openEditWithRequest(page, "en");
    await expect(page.getByTestId(`subscription-checkin-where-${FLOOR.milepost1}`).locator("input")).toBeChecked();
    await expect(page.getByTestId("subscription-checkin-method-call").locator("input")).toBeChecked();
    await expect(page.getByTestId("subscription-checkin-consent")).toHaveCount(0);
    await page.getByTestId("subscription-checkin-method-text").click();
    await page.getByTestId("subscription-save").click();
    await expect(page.getByTestId("subscription-checkin-answer")).toHaveText(catalogText("en", "checkin.savedMethod"));
    expect(bodies.find((body) => body.kind === "change")!.checkin).toEqual({ rsn: MILEPOST, floor: FLOOR.milepost1, method: "text", consent_version: null });
  });

  test("asks for the consent again for another floor, and withdraws with 'Withdraw my check-in request'", async ({ page }) => {
    const bodies = await openEditWithRequest(page, "en", { v: 1, status: "changed", checkin: "withdrawn" });
    await page.getByTestId(`subscription-checkin-where-${FLOOR.milepost2}`).click();
    await expect(page.getByTestId("subscription-checkin-consent")).toBeVisible();
    await page.getByTestId("subscription-checkin-withdraw").click();
    await expect(page.getByTestId("subscription-checkin-withdraw-note")).toBeVisible();
    await page.getByTestId("subscription-save").click();
    await expect(page.getByTestId("subscription-checkin-answer")).toHaveText(catalogText("en", "R33.withdrawn"));
    expect(bodies.find((body) => body.kind === "change")!.checkin).toBeNull();
  });

  test("when where the resident lives changes, says the request will be withdrawn and offers to ask again for the new floor", async ({ page }) => {
    const bodies = await openEditWithRequest(page, "en", { v: 1, status: "changed", checkin: "requested" });
    await page.getByTestId(`subscription-floor-${FLOOR.milepost1}`).click();
    await expect(page.getByTestId("subscription-checkin-moved")).toHaveText(catalogText("en", "checkin.moved"));
    await page.getByTestId(`subscription-checkin-where-${FLOOR.milepost2}`).click();
    await expect(page.getByTestId("subscription-checkin-consent")).toBeVisible();
    await page.getByTestId("subscription-save").click();
    await expect(page.getByTestId("subscription-checkin-error-consent")).toBeVisible();
    await page.getByTestId("subscription-checkin-agree").click();
    await page.getByTestId("subscription-save").click();
    await expect(page.getByTestId("subscription-checkin-answer")).toHaveText(catalogText("en", "checkin.savedRequested"));
    expect(bodies.find((body) => body.kind === "change")!.checkin).toEqual({ rsn: MILEPOST, floor: FLOOR.milepost2, method: "call", consent_version: CHECKIN_CONSENT_VERSION });
  });

  for (const lang of ["en", "ur"]) {
    test(`with a request held, moved to a new floor, in ${lang} at 390px`, async ({ page }) => {
      await openEditWithRequest(page, lang, { v: 1, status: "changed", checkin: "uncovered" });
      await page.getByTestId(`subscription-floor-${FLOOR.milepost1}`).click();
      await page.getByTestId(`subscription-checkin-where-${FLOOR.milepost2}`).click();
      await page.getByTestId("subscription-checkin").scrollIntoViewIfNeeded();
      expect(await overflow(page)).toEqual({ page: 0, main: 0 });
      await expectBaseline(page, `checkin-edit-moved-${lang}-390.png`);
      await page.getByTestId("subscription-checkin-agree").click();
      await page.getByTestId("subscription-save").click();
      await expect(page.getByTestId("subscription-checkin-answer")).toBeVisible();
      await expectBaseline(page, `checkin-edit-uncovered-${lang}-390.png`);
    });
  }
});
