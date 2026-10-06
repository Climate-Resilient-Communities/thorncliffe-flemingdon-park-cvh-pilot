import type { Metadata } from "next";
import { createTranslator, type AbstractIntlMessages } from "next-intl";
import { HUB_PHONE_E164 } from "@/contracts/hubNumber.generated";
import { displayPhone } from "@/contracts/phone";
import { languageOf, type LaunchCode } from "@/i18n/languages";
import { stdoutMessagingLog } from "@/modules/messaging";
import { termsPageView } from "@/modules/subscriptions";
import { Screen, Stack } from "@/ui";
import { currentSignupConsentVersion, signupBuildingList } from "../../signup";
import { staffPage } from "../guard";
import { SignupForm } from "./SignupForm";
import type { ResidentWords } from "./SignupFormView";
import { TextSignupView, type TextSignupModel } from "./TextSignupView";
import { TEXT_SIGNUP_PAGE, chosenLanguage, groupOptions, languageName, languageOptions, neighbourhoodOptions, signupFormLabels, signupText, type BuildingOption } from "./view";

export const metadata: Metadata = { title: signupText("title") };
// The action starts the dispatcher after its answer, inside this function's time (S06.02's note: a caller of kickDispatcher exports 60).
export const maxDuration = 60;

type Query = { lang?: string | string[] };

/** The resident's words on this screen, in their language, from the translated catalog (an untranslated string is English behind "[EN]"). */
async function residentWords(lang: LaunchCode): Promise<ResidentWords> {
  const messages = (await import(`../../../i18n/messages/${lang}.json`)).default as AbstractIntlMessages;
  const t = createTranslator({ locale: lang, messages }) as unknown as (key: string, values?: Record<string, string>) => string;
  const { bcp47, dir } = languageOf(lang);
  return {
    bcp47,
    dir,
    age: t("signup.age"),
    expect: t("signup.expect"),
    howStop: t("R05.howStop"),
    // S08.05: the check-in request's consent wording (that an ambassador on their floor will see their number and floor, not an emergency
    // service, when to call 911), and what to tell them when no ambassador covers the floor.
    checkin: { sees: t("checkin.sees"), notEmergency: t("R33.notEmergency"), call911: t("x01.call"), untilYes: t("checkin.untilYes"), uncovered: t("checkin.uncovered", { hub: displayPhone(HUB_PHONE_E164) }) },
  };
}

/** The buildings for the optional building and floor; none (the choice is left out) when they cannot be read. */
async function buildingOptions(): Promise<BuildingOption[]> {
  try {
    return (await signupBuildingList()).map(({ rsn, address, neighbourhoodId, floors }) => ({ rsn, address, neighbourhoodId, floors }));
  } catch (error) {
    stdoutMessagingLog.error("signup.buildings_unreadable", { module: "subscriptions", error: error instanceof Error ? error.name : "NonError" });
    return [];
  }
}

/** The form step's model: the terms and privacy page in the resident's language, as the terms page has it. */
function formModel(lang: LaunchCode, consentVersion: string): TextSignupModel {
  const view = termsPageView(lang);
  const { bcp47, dir } = languageOf(lang);
  return { step: "form", language: languageName(lang), terms: { draft: view.status !== "published", bcp47, dir, sections: view.document.sections }, consentVersion };
}

/**
 * "Text sign-up" (S07.03): a Coordinator, an Ambassador or an Admin starts a resident's sign-up for texts at an event or the Hub desk, on their
 * phone. First the resident's language; then the terms and privacy page in that language, to read with the resident, and the form (the number,
 * the neighbourhood, the optional building, floor and groups, and the two statements the staff member ticks for the resident). The policy
 * action `signup.assist`; a Director sees why they cannot. The resident still replies YES themselves. Nothing here lists who signed up or
 * shows a number. While no terms may be signed up to (production with unpublished terms) the page says so and has no form.
 */
export default staffPage(
  {
    route: TEXT_SIGNUP_PAGE,
    access: "hub",
    action: "signup.assist",
    refused: () => (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <Stack gap="related">
            <h1>{signupText("title")}</h1>
            <p>{signupText("lead")}</p>
          </Stack>
          <p role="alert" className="hub-error">
            {signupText("errors.forbidden")}
          </p>
        </Stack>
      </Screen>
    ),
  },
  async (_session, props: { searchParams?: Promise<Query> }) => {
    const query = (await props.searchParams) ?? {};
    const lang = chosenLanguage(query.lang);
    const consentVersion = currentSignupConsentVersion();
    if (consentVersion === null || lang === null) {
      const model: TextSignupModel = consentVersion === null ? { step: "unavailable" } : { step: "language", languages: languageOptions() };
      return (
        <Screen surface="staff">
          <TextSignupView model={model} />
        </Screen>
      );
    }
    const [resident, buildings] = await Promise.all([residentWords(lang), buildingOptions()]);
    return (
      <Screen surface="staff">
        <TextSignupView
          model={formModel(lang, consentVersion)}
          form={
            <SignupForm
              labels={signupFormLabels()}
              lang={lang}
              consentVersion={consentVersion}
              neighbourhoods={neighbourhoodOptions()}
              buildings={buildings}
              groups={groupOptions()}
              resident={resident}
              nextHref={TEXT_SIGNUP_PAGE}
            />
          }
        />
      </Screen>
    );
  },
);
