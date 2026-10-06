import { expect, test, type Page } from "@playwright/test";
import type { SignupState } from "../../src/app/staff/text-signup/control";
import type { SignupFormProps } from "../../src/app/staff/text-signup/SignupFormView";
import type { TextSignupModel } from "../../src/app/staff/text-signup/TextSignupView";
import { TEXT_SIGNUP_PAGE, groupOptions, languageName, languageOptions, neighbourhoodOptions, refusalMessage, signupFormLabels } from "../../src/app/staff/text-signup/view";
import { languageOf } from "../../src/i18n/languages";
import ur from "../../src/i18n/messages/ur.json";
import { termsPageView } from "../../src/modules/subscriptions";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S07.03: the Text sign-up screen in the Hub shell, in en as an Admin sees it, for a resident who wants Urdu: the language step; the form step with the
// committed terms and privacy page in the resident's language (today English standing in for the Urdu, marked, under the draft note) and the age
// statement in Urdu; what an accepted sign-up leaves (the same for every number, with the next steps in Urdu); a refusal; and the page while no
// terms may be signed up to. The page's real body and form render with the stand-in states the server action would return. The behaviour is
// asserted in src/app/staff/text-signup and test/db/assistedSignup.db.test.ts; these pictures show what it looks like.
const brand = hubBrand();
const HEIGHT = 844;
const VERSION = "2026-10-02.1";

const terms = termsPageView("ur");
const { bcp47, dir } = languageOf("ur");
const FORM_STEP: TextSignupModel = { step: "form", language: languageName("ur"), terms: { draft: terms.status !== "published", bcp47, dir, sections: terms.document.sections }, consentVersion: VERSION };
const form = (answer: SignupState): SignupFormProps & { answer: SignupState } => ({
  labels: signupFormLabels(),
  lang: "ur",
  consentVersion: VERSION,
  neighbourhoods: neighbourhoodOptions(),
  buildings: [
    { rsn: "9100001", address: "45 Overlea Boulevard", neighbourhoodId: "TP", floors: [{ id: "0190f000-0000-7000-8000-000000000001", label: "1" }] },
    { rsn: "9100002", address: "10 Gateway Boulevard", neighbourhoodId: "FP", floors: [] },
  ],
  groups: groupOptions(),
  resident: {
    bcp47,
    dir,
    age: ur.signup.age,
    expect: ur.signup.expect,
    howStop: ur.R05.howStop,
    checkin: { sees: ur.checkin.sees, notEmergency: ur.R33.notEmergency, call911: ur.x01.call, untilYes: ur.checkin.untilYes, uncovered: ur.checkin.uncovered.replace("{hub}", "(416) 421-8997") },
  },
  nextHref: TEXT_SIGNUP_PAGE,
  answer,
});

const STATES = {
  language: () => ({ model: { step: "language", languages: languageOptions() } as TextSignupModel }),
  form: () => ({ model: FORM_STEP, form: form({ status: "idle" }) }),
  done: () => ({ model: FORM_STEP, form: form({ status: "done", at: 1 }) }),
  // S08.05: a sign-up whose check-in request's floor nobody covers.
  doneUncovered: () => ({ model: FORM_STEP, form: form({ status: "done", at: 1, checkin: "uncovered" }) }),
  refused: () => ({ model: FORM_STEP, form: form({ status: "refused", at: 1, message: refusalMessage("phone_not_canadian") }) }),
  unavailable: () => ({ model: { step: "unavailable" } as TextSignupModel }),
} as const;
const WIDTHS: Record<keyof typeof STATES, number[]> = { language: [390, 1280], form: [390, 1280], done: [390], doneUncovered: [390], refused: [390], unavailable: [390] };

async function open(page: Page, state: keyof typeof STATES, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  await mount(page, "TextSignupFixture", { texts: REAL_TEXTS, brand, ...STATES[state]() }, { lang: "en" });
}

for (const state of Object.keys(STATES) as (keyof typeof STATES)[]) {
  for (const width of WIDTHS[state]) {
    test(`text sign-up ${state} at ${width}px`, async ({ page }) => {
      await open(page, state, width);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign up a resident for texts");
      // No page needs a sideways scroll.
      const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);

      if (state === "language") {
        await expect(page.getByTestId("text-signup-languages").getByRole("link")).toHaveCount(15);
        await expect(page.getByRole("link", { name: "Urdu (اردو)" })).toHaveAttribute("href", "/staff/text-signup?lang=ur");
      }
      if (state === "unavailable") await expect(page.getByTestId("text-signup-unavailable")).toContainText("the terms are not published yet");
      if (state === "form" || state === "done" || state === "refused") {
        await expect(page.getByTestId("text-signup-language")).toHaveText("Resident's language: Urdu");
        await expect(page.getByTestId("text-signup-terms")).toHaveAttribute("lang", "ur");
        await expect(page.getByTestId("text-signup-age-statement")).toHaveAttribute("dir", "rtl");
        const send = page.getByRole("button", { name: "Send the confirmation text" });
        await expect(send).toBeVisible();
        expect((await send.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      if (state === "done") {
        await expect(page.getByTestId("text-signup-answer")).toContainText("If this number can get texts, the confirmation text is on its way.");
        await expect(page.getByTestId("text-signup-next-steps")).toHaveAttribute("lang", "ur");
      }
      if (state === "refused") await expect(page.getByRole("alert")).toContainText("That is not a Canadian mobile number.");

      await expectBaseline(page, `text-signup-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}

// S08.05: the check-in request on the staff-assisted sign-up: offered once a building and floor are chosen (the form's state given through its test
// seam: the fixture is drawn without its script), with the method, the consent wording in the resident's language, and the box the staff member ticks
// once the resident agrees.
test("text sign-up with a check-in request opened at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: HEIGHT });
  const props = { ...form({ status: "idle" }), initial: { rsn: "9100001", floorId: "0190f000-0000-7000-8000-000000000001", asking: true } };
  await mount(page, "TextSignupFixture", { texts: REAL_TEXTS, brand, model: FORM_STEP, form: props }, { lang: "en" });
  await expect(page.getByTestId("text-signup-checkin-wording")).toHaveAttribute("lang", "ur");
  await expect(page.getByTestId("text-signup-checkin-wording")).toContainText(ur.checkin.sees);
  await expect(page.getByTestId("text-signup-checkin-ask")).toBeChecked();
  await page.getByTestId("text-signup-checkin-call").check();
  await expectBaseline(page, "text-signup-en-checkin-390.png", { fullPage: true });
});

test("text sign-up offers a check-in only once a floor is chosen, at 390px", async ({ page }) => {
  await open(page, "form", 390);
  await expect(page.getByTestId("text-signup-checkin-needs-floor")).toBeVisible();
  await expect(page.getByTestId("text-signup-checkin-ask")).toHaveCount(0);
});
