import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { BUILDINGS, FLOOR, buildingList, savedChoices, seedChoices, stubBuildingList } from "./choices-fixture";
import terms from "../../data/catalogue/terms.json";
import { LANGUAGES, WIDTHS, catalogText, expectBaseline, openResident } from "./helpers";

// S07.02: "Get text alerts" (R-05) and what to expect once it is sent (R-06), at /{lang}/text-alerts. The server behind these tests has no
// database, so /api/buildings and /api/signup are answered here (the sign-up's own behaviour against a database is test/db/signup.db.test.ts).
// The terms are published (the owner reviewed them and waived counsel's review for the pilot), so the form records that version and says
// nothing about a draft.
// Every number is fictional (555).

const MILEPOST = BUILDINGS[0].rsn; // Thorncliffe Park
const DRIVE = BUILDINGS[1].rsn; // Thorncliffe Park
const OVERLEA = BUILDINGS[3].rsn; // Flemingdon Park
/** The terms version the page shows (the committed terms, published or draft), which the form sends. */
const VERSION = terms.consentVersion;

/** Answers /api/signup as told, and keeps every request it got (its body and its headers). */
async function stubSignup(page: Page, answer: { status: number; json: unknown } = { status: 202, json: { v: 1, status: "accepted" } }) {
  const requests: { body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  await page.route("**/api/signup", async (route: Route, request: Request) => {
    requests.push({ body: request.postDataJSON() as Record<string, unknown>, headers: await request.allHeaders() });
    await route.fulfill({ status: answer.status, json: answer.json, headers: { "Cache-Control": "no-store" } });
  });
  return requests;
}

const choices = (value: Record<string, unknown>) => JSON.stringify({ v: 1, welcomed: true, ...value });

async function fillValid(page: Page) {
  await page.getByTestId("signup-phone").fill("(416) 555-0123");
  await page.getByTestId("signup-terms-agree").click();
  await page.getByTestId("signup-age").click();
}

test.describe("the form", () => {
  test("is filled from the phone's choices: language, buildings, floors and groups, with the neighbourhood they share", async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(page, choices({ lang: "fr", buildings: [MILEPOST, DRIVE], floors: [FLOOR.milepost2], groups: ["seniors", "checkin"] }));

    await openResident(page, "/en/text-alerts", 390);

    await expect(page.locator("main h1")).toHaveText(catalogText("en", "R05.title"));
    await expect(page.getByTestId("signup-lang")).toHaveValue("fr");
    await expect(page.getByTestId(`signup-building-${MILEPOST}`).locator("input")).toBeChecked();
    await expect(page.getByTestId(`signup-building-${DRIVE}`).locator("input")).toBeChecked();
    await expect(page.getByTestId(`signup-floor-${FLOOR.milepost2}`).locator("input")).toBeChecked();
    await expect(page.getByTestId(`signup-floor-${FLOOR.milepost1}`).locator("input")).not.toBeChecked();
    await expect(page.getByTestId("signup-group-seniors").locator("input")).toBeChecked();
    // The check-in request is E08's, with its coverage check: the form does not offer it.
    await expect(page.getByTestId("signup-group-checkin")).toHaveCount(0);
    // Both saved buildings are in Thorncliffe Park, so it is chosen; the number is asked.
    await expect(page.getByTestId("signup-nbhd-TP").locator("input")).toBeChecked();
    await expect(page.getByTestId("signup-phone")).toHaveValue("");
    // The terms, linked, with the version the sign-up records: published, so no draft note.
    await expect(page.getByTestId("signup-terms-link")).toHaveAttribute("href", "/en/terms");
    await expect(page.getByTestId("signup-terms-version")).toContainText(VERSION);
    await expect(page.getByTestId("signup-terms-draft")).toHaveCount(0);
    // What carriers ask an opt-in to say: the program, how often, that rates may apply, and HELP and STOP.
    const disclosure = page.getByTestId("signup-sms-terms");
    for (const words of ["Thorncliffe Park Community Hub", "Message frequency varies", "Msg & data rates may apply", "HELP", "STOP"]) await expect(disclosure).toContainText(words);
    await expect(page.getByTestId("signup-terms-agree").locator("input")).not.toBeChecked();
    await expect(page.getByTestId("signup-age").locator("input")).not.toBeChecked();
  });

  test("chooses no neighbourhood when the saved buildings are in both, or when none is saved", async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(page, choices({ buildings: [MILEPOST, OVERLEA] }));
    await openResident(page, "/en/text-alerts", 390);
    await expect(page.getByTestId(`signup-building-${OVERLEA}`)).toBeVisible();
    await expect(page.locator('input[name="nbhd"]:checked')).toHaveCount(0);

    await page.evaluate(() => localStorage.setItem("cvh.choices", JSON.stringify({ v: 1, welcomed: true })));
    await page.reload();
    await expect(page.getByTestId("signup-nbhd-TP")).toBeVisible();
    await expect(page.locator('input[name="nbhd"]:checked')).toHaveCount(0);
  });

  test("refuses on the phone what the server would refuse, naming what is missing, and sends nothing", async ({ page }) => {
    await stubBuildingList(page);
    const requests = await stubSignup(page);
    await openResident(page, "/en/text-alerts", 390);

    await page.getByTestId("signup-phone").fill("212 555 0123");
    await page.getByTestId("signup-send").click();

    await expect(page.getByTestId("signup-errorbox")).toBeFocused();
    await expect(page.getByTestId("signup-errorbox")).toContainText(catalogText("en", "R05.missingNbhd"));
    await expect(page.getByTestId("signup-error-phone")).toHaveText(catalogText("en", "signup.error.phone_not_canadian"));
    await expect(page.getByTestId("signup-error-nbhd")).toBeVisible();
    await expect(page.getByTestId("signup-error-terms")).toHaveText(catalogText("en", "signup.error.terms_not_agreed"));
    await expect(page.getByTestId("signup-error-age")).toHaveText(catalogText("en", "signup.error.age_not_confirmed"));
    await expect(page.getByTestId("signup-phone")).toHaveAttribute("aria-invalid", "true");
    expect(requests).toEqual([]);
  });

  test("sends the number, the choices as changed on the form and the terms version, with no cookie, then shows what to expect (R-06)", async ({ page, context }) => {
    await stubBuildingList(page);
    await seedChoices(page, choices({ lang: "en", buildings: [MILEPOST], floors: [FLOOR.milepost1], groups: ["newcomers"] }));
    const requests = await stubSignup(page);
    await openResident(page, "/en/text-alerts", 390);

    await fillValid(page);
    await expect(page.getByTestId("signup-phone-shown")).toContainText("(416) 555-0123");
    // Change choices on the form: another language, another building, a floor less, a group more.
    await page.getByTestId("signup-lang").selectOption("ur");
    await page.getByTestId("signup-building-search").fill("Overlea");
    await page.getByTestId(`signup-add-${OVERLEA}`).click();
    await page.getByTestId(`signup-floor-${FLOOR.milepost1}`).click();
    await page.getByTestId("signup-group-seniors").click();
    await page.getByTestId("signup-nbhd-FP").click();
    await page.getByTestId("signup-send").click();

    await expect(page.getByTestId("signup-sent")).toBeVisible();
    expect(requests.map((r) => r.body)).toEqual([
      {
        v: 1,
        phone: "(416) 555-0123",
        lang: "ur",
        neighbourhood: "FP",
        places: [
          { rsn: MILEPOST, floors: [] },
          { rsn: OVERLEA, floors: [] },
        ],
        groups: ["seniors", "newcomers"],
        consent_version: VERSION,
        terms_agreed: true,
        age_confirmed: true,
      },
    ]);
    expect(requests[0]!.headers.cookie).toBeUndefined();

    // R-06: the same words whatever the number, what happens next, how to stop, how to change, and what to do if no text comes.
    await expect(page.locator("main h1")).toHaveText(catalogText("en", "R05.sentTitle"));
    await expect(page.locator("main h1")).toBeFocused();
    await expect(page.getByTestId("signup-on-its-way")).toHaveText(catalogText("en", "signup.onItsWay"));
    await expect(page.getByTestId("signup-expect")).toHaveText(catalogText("en", "signup.expect"));
    await expect(page.getByTestId("signup-how-stop")).toHaveText(catalogText("en", "R05.howStop"));
    await expect(page.getByTestId("signup-how-change")).toHaveText(catalogText("en", "signup.howChange"));
    // This server has no texting number configured, so the line says where to text START without one.
    await expect(page.getByTestId("signup-start-help")).toHaveText(catalogText("en", "signup.startHelpNoNumber"));
    // Nothing about the sign-up is kept on the phone: the choices are as they were, and there is no cookie.
    expect(await savedChoices(page)).toMatchObject({ lang: "en", buildings: [MILEPOST], floors: [FLOOR.milepost1], groups: ["newcomers"] });
    expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage })))).not.toContain("555");
    expect(await context.cookies()).toEqual([]);

    // Back to the form, with what was typed.
    await page.getByTestId("signup-fix").click();
    await expect(page.getByTestId("signup-phone")).toHaveValue("(416) 555-0123");
  });

  test("sent before the building list has loaded, waits for it and keeps the saved floors; a number in Urdu digits is accepted", async ({ page }) => {
    let release: () => void = () => {};
    const listHeld = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/buildings", async (route: Route) => {
      await listHeld;
      await route.fulfill({ json: buildingList(), headers: { "Cache-Control": "no-store" } });
    });
    await seedChoices(page, choices({ lang: "en", buildings: [MILEPOST], floors: [FLOOR.milepost1] }));
    const requests = await stubSignup(page);
    await openResident(page, "/en/text-alerts", 390);

    await page.getByTestId("signup-phone").fill("۴۱۶ ۵۵۵ ۰۱۲۳");
    await page.getByTestId("signup-terms-agree").click();
    await page.getByTestId("signup-age").click();
    await page.getByTestId("signup-nbhd-TP").click();
    await page.getByTestId("signup-send").click();

    // Nothing is sent while the list is loading: the saved floor cannot be placed yet.
    await expect(page.getByTestId("signup-send")).toBeDisabled();
    expect(requests).toEqual([]);
    release();

    await expect(page.getByTestId("signup-sent")).toBeVisible();
    expect(requests.map((r) => r.body.places)).toEqual([[{ rsn: MILEPOST, floors: [FLOOR.milepost1] }]]);
    expect(requests.map((r) => r.body.phone)).toEqual(["۴۱۶ ۵۵۵ ۰۱۲۳"]);
  });

  test("shows the server's reason in the page's language: a refused number, the limit, the terms changed, no connection", async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(page, choices({ buildings: [MILEPOST] }));
    const cases: [number, string][] = [
      [400, "phone_not_canadian"],
      [429, "rate_limited"],
      [409, "terms_changed"],
      [503, "signup_unavailable"],
    ];
    await openResident(page, "/ur/text-alerts", 390);
    await fillValid(page);
    for (const [status, code] of cases) {
      await page.unroute("**/api/signup");
      await stubSignup(page, { status, json: { error: { code, message_key: `signup.error.${code}` } } });
      await page.getByTestId("signup-send").click();
      await expect(page.getByTestId("signup-errorbox"), code).toHaveText(catalogText("ur", `signup.error.${code}`));
    }
    await page.unroute("**/api/signup");
    await page.route("**/api/signup", (route) => route.abort("internetdisconnected"));
    await page.getByTestId("signup-send").click();
    await expect(page.getByTestId("signup-errorbox")).toHaveText(catalogText("ur", "signup.error.network"));
    await expect(page.getByTestId("signup-sent")).toHaveCount(0);
  });

  test("is reached from R-34, What I have told the CVH", async ({ page }) => {
    await stubBuildingList(page);
    await openResident(page, "/en/choices", 390);
    await page.getByTestId("text-invite-yes").click();
    await page.waitForURL("**/en/text-alerts");
    await expect(page.locator("main h1")).toHaveText(catalogText("en", "R05.title"));
  });
});

test.describe("right to left", () => {
  test("mirrors in Urdu, while the number, the version and the addresses stay left-to-right runs", async ({ page }) => {
    await stubBuildingList(page);
    await seedChoices(page, choices({ buildings: [MILEPOST] }));
    await openResident(page, "/ur/text-alerts", 390);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("signup-phone")).toHaveAttribute("dir", "ltr");
    await expect(page.getByTestId("signup-terms-version").locator("bdi")).toHaveAttribute("dir", "ltr");
    await expect(page.getByTestId(`signup-building-${MILEPOST}`).locator("bdi").first()).toHaveAttribute("dir", "ltr");
    // The heading starts at the right edge, the phone field's label too.
    const edges = await page.evaluate(() => {
      const main = document.querySelector("main")!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("main h1")!);
      const text = range.getBoundingClientRect();
      return { right: main.right - text.right, left: text.left - main.left };
    });
    expect(edges.right).toBeLessThan(edges.left);

    await page.route("**/api/signup", (route) => route.fulfill({ status: 202, json: { v: 1, status: "accepted" } }));
    await fillValid(page);
    await page.getByTestId("signup-send").click();
    await expect(page.locator("main h1")).toHaveText(catalogText("ur", "R05.sentTitle"));
  });
});

for (const language of LANGUAGES) {
  test(`/${language.code}/text-alerts is the form in the ${language.code} shell, every word from its catalog`, async ({ page }) => {
    await stubBuildingList(page);
    const response = await openResident(page, `/${language.code}/text-alerts`, 390);

    expect(response!.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", language.bcp47);
    await expect(page.locator("html")).toHaveAttribute("dir", language.dir);
    await expect(page.getByTestId("shell-nav")).toBeVisible();
    await expect(page.locator("main h1")).toHaveText(catalogText(language.code, "R05.title"));
    await expect(page.getByTestId("signup-terms-agree")).toContainText(catalogText(language.code, "signup.termsAgree"));
    await expect(page.getByTestId("signup-age")).toContainText(catalogText(language.code, "signup.age"));
    await expect(page.getByTestId("signup-nbhd-TP")).toContainText(catalogText(language.code, "neighbourhoods.TP"));
    // Nothing on the form falls back to English.
    expect(await page.locator("main").innerText()).not.toContain("[EN]");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  for (const width of WIDTHS) {
    test(`/${language.code}/text-alerts has no horizontal scrolling at ${width}px, on the form and once sent`, async ({ page }) => {
      await stubBuildingList(page);
      await seedChoices(page, choices({ buildings: [MILEPOST, OVERLEA], floors: [FLOOR.milepost1] }));
      await page.route("**/api/signup", (route) => route.fulfill({ status: 202, json: { v: 1, status: "accepted" } }));
      await openResident(page, `/${language.code}/text-alerts`, width);
      const overflow = () =>
        page.evaluate(() => {
          const main = document.querySelector("main")!;
          return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: main.scrollWidth - main.clientWidth };
        });
      await page.getByTestId("signup-send").click();
      await expect(page.getByTestId("signup-errorbox")).toBeVisible();
      expect(await overflow()).toEqual({ page: 0, main: 0 });

      await page.getByTestId("signup-phone").fill("416 555 0123");
      await page.getByTestId("signup-nbhd-TP").click();
      await page.getByTestId("signup-terms-agree").click();
      await page.getByTestId("signup-age").click();
      await page.getByTestId("signup-send").click();
      await expect(page.getByTestId("signup-sent")).toBeVisible();
      expect(await overflow()).toEqual({ page: 0, main: 0 });
    });
  }
}

test.describe("baselines", () => {
  for (const lang of ["en", "ur"]) {
    for (const width of WIDTHS) {
      test(`the form in ${lang} at ${width}px`, async ({ page }) => {
        await stubBuildingList(page);
        await seedChoices(page, choices({ lang, buildings: [MILEPOST], floors: [FLOOR.milepost1], groups: ["seniors"] }));
        await openResident(page, `/${lang}/text-alerts`, width);
        await expect(page.getByTestId("signup-nbhd-TP").locator("input")).toBeChecked();
        await expectBaseline(page, `signup-form-${lang}-${width}.png`);
      });
    }
    test(`what to expect once sent (R-06) in ${lang} at 390px`, async ({ page }) => {
      await stubBuildingList(page);
      await page.route("**/api/signup", (route) => route.fulfill({ status: 202, json: { v: 1, status: "accepted" } }));
      await seedChoices(page, choices({ lang, buildings: [MILEPOST] }));
      await openResident(page, `/${lang}/text-alerts`, 390);
      await fillValid(page);
      await page.getByTestId("signup-send").click();
      await expect(page.getByTestId("signup-sent")).toBeVisible();
      await expectBaseline(page, `signup-sent-${lang}-390.png`);
    });
  }
});
