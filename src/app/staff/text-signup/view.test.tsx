import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SIGNUP_ERROR_CODES } from "@/contracts/signup";
import { LAUNCH_CODES } from "@/i18n/languages";
import type { SignupState } from "./control";
import { SignupFormView, type SignupFormProps } from "./SignupFormView";
import { TEXT_SIGNUP_PAGE, chosenLanguage, groupOptions, languageOptions, neighbourhoodOptions, refusalMessage, signupFormLabels } from "./view";

const props: SignupFormProps = {
  labels: signupFormLabels(),
  lang: "ur",
  consentVersion: "2026-10-02.1",
  neighbourhoods: neighbourhoodOptions(),
  buildings: [{ rsn: "9100001", address: "1 Sample Road", neighbourhoodId: "TP", floors: [{ id: "0190f000-0000-7000-8000-000000000002", label: "2" }] }],
  groups: groupOptions(),
  resident: {
    bcp47: "ur",
    dir: "rtl",
    age: "میری عمر 16 سال",
    expect: "YES 48",
    howStop: "STOP",
    checkin: { sees: "فون نمبر اور منزل", notEmergency: "ہنگامی سروس نہیں", call911: "911", untilYes: "YES", uncovered: "ہب (416) 421-8997" },
  },
  nextHref: TEXT_SIGNUP_PAGE,
};
const draw = (answer: SignupState) => renderToStaticMarkup(<SignupFormView {...props} answer={answer} />);

describe("the language step", () => {
  it("offers every launch language once, each linking to the form in it, with its own name marked in its own language", () => {
    const options = languageOptions();
    expect(options.map((o) => o.code)).toEqual([...LAUNCH_CODES]);
    expect(options.find((o) => o.code === "ur")).toEqual({ code: "ur", name: "Urdu", native: { text: "اردو", bcp47: "ur", dir: "rtl" }, href: "/staff/text-signup?lang=ur" });
    expect(options.find((o) => o.code === "en")).toEqual({ code: "en", name: "English", native: null, href: "/staff/text-signup?lang=en" });
  });

  it("reads the chosen language from the query, and nothing else", () => {
    expect(chosenLanguage("prs")).toBe("prs");
    expect(chosenLanguage(["es", "fr"])).toBe("es");
    for (const other of [undefined, "", "zh-Hant", "de", ["xx"]]) expect(chosenLanguage(other)).toBeNull();
  });
});

describe("the form", () => {
  it("sends the language and the terms version shown, and asks for the number, the neighbourhood, and the two statements the resident gives", () => {
    const html = draw({ status: "idle" });
    expect(html).toContain('name="lang" value="ur"');
    expect(html).toContain('name="consent_version" value="2026-10-02.1"');
    const required = (name: string) => new RegExp(`<input[^>]*required=""[^>]*name="${name}"`);
    for (const name of ["phone", "neighbourhood", "terms_agreed", "age_confirmed"]) expect(html, name).toMatch(required(name));
    expect(html).toContain("The resident has heard the terms in their language and agrees to them.");
  });

  it("shows the age statement in the resident's language, marked as such", () => {
    expect(draw({ status: "idle" })).toContain('<p lang="ur" dir="rtl" class="hub-resident-words" data-testid="text-signup-age-statement">میری عمر 16 سال</p>');
  });

  it("offers the building as optional, grouped by neighbourhood, and the groups", () => {
    const html = draw({ status: "idle" });
    expect(html).toContain('<optgroup label="Thorncliffe Park"><option value="9100001">1 Sample Road</option></optgroup>');
    for (const group of ["Seniors", "Newcomers", "Families with young children"]) expect(html).toContain(group);
  });

  it("after a sign-up, says the same thing for every number, tells the staff member what the resident must do and shows it in the resident's language", () => {
    const html = draw({ status: "done", at: 1 });
    expect(html).toContain("If this number can get texts, the confirmation text is on its way.");
    expect(html).toContain("The resident must reply YES within 48 hours.");
    expect(html).toContain('lang="ur" dir="rtl" data-testid="text-signup-next-steps"');
    expect(html).toContain(`href="${TEXT_SIGNUP_PAGE}"`);
  });

  it("shows a refusal as an alert the number field points to", () => {
    const html = draw({ status: "refused", at: 1, message: refusalMessage("phone_not_canadian") });
    expect(html).toContain('role="alert"');
    expect(html).toContain("That is not a Canadian mobile number.");
    expect(html).toContain('aria-describedby="text-signup-number-hint text-signup-error"');
  });

  it("has a message for every refusal of a sign-up", () => {
    for (const code of [...SIGNUP_ERROR_CODES, "failed"] as const) expect(refusalMessage(code)).toMatch(/\. Nothing was sent\.$/);
  });
});
