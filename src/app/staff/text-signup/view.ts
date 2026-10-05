// What the Text sign-up page shows (S07.03): the view model, with every staff text already resolved from the English catalog, so the components
// that draw it know none of it. Pure: no I/O. The resident's own words (the terms, the age statement, what happens next) are not here: the page
// reads them in the resident's language from the translated catalog and the terms.
import { SIGNUP_GROUPS, type SignupErrorCode } from "@/contracts/signup";
import { LAUNCH_LANGUAGES, isLaunchCode, type LaunchCode } from "@/i18n/languages";
import { englishText } from "@/i18n/text";

export const TEXT_SIGNUP_PAGE = "/staff/text-signup";

export const signupText = (key: string, values?: Record<string, string | number>) => englishText(`staff.textSignup.${key}`, values);

/** The language a resident's texts can be in, as the first step lists it: its English name, its own name (none for English) and the address of the next step. */
export interface LanguageOption {
  code: LaunchCode;
  name: string;
  native: { text: string; bcp47: string; dir: "ltr" | "rtl" } | null;
  href: string;
}

/** The English name of a launch language. */
export function languageName(code: LaunchCode): string {
  return code === "en" ? englishText("staff.drillRoster.english") : englishText(`staff.compose.languageNames.${code}`);
}

/** Every launch language a sign-up can choose, in the resident language picker's order, each linking to the form in that language. */
export function languageOptions(): LanguageOption[] {
  return LAUNCH_LANGUAGES.map(({ code, native, bcp47, dir }) => ({
    code,
    name: languageName(code),
    // No second name where the language's own name is the English one (Tagalog).
    native: native === languageName(code) ? null : { text: native, bcp47, dir },
    href: `${TEXT_SIGNUP_PAGE}?lang=${code}`,
  }));
}

/** The resident's language from the page's query, or null (the page then asks for it first). */
export function chosenLanguage(value: unknown): LaunchCode | null {
  const one = Array.isArray(value) ? value[0] : value;
  return isLaunchCode(one) ? one : null;
}

/** One building of the optional building choice: its address, its neighbourhood and its floors. */
export interface BuildingOption {
  rsn: string;
  address: string;
  neighbourhoodId: string;
  floors: { id: string; label: string }[];
}

export interface SignupFormLabels {
  formHeading: string;
  number: string;
  numberHint: string;
  neighbourhood: string;
  required: string;
  optional: string;
  building: string;
  buildingNone: string;
  floor: string;
  floorNone: string;
  /** "Floor {label}", left as a template for the form to fill. */
  floorLabel: string;
  groups: string;
  agreed: string;
  age: string;
  ageConfirmed: string;
  send: string;
  sending: string;
  doneTitle: string;
  done: string;
  doneYes: string;
  doneShow: string;
  next: string;
  limit: string;
  noList: string;
}

export function signupFormLabels(): SignupFormLabels {
  const keys = [
    "formHeading",
    "number",
    "numberHint",
    "neighbourhood",
    "required",
    "optional",
    "building",
    "buildingNone",
    "floor",
    "floorNone",
    "groups",
    "agreed",
    "age",
    "ageConfirmed",
    "send",
    "sending",
    "doneTitle",
    "done",
    "doneYes",
    "doneShow",
    "next",
    "limit",
    "noList",
  ] as const;
  return { ...(Object.fromEntries(keys.map((key) => [key, signupText(key)])) as Omit<SignupFormLabels, "floorLabel">), floorLabel: signupText("floorLabel", { label: "{label}" }) };
}

/** The two neighbourhoods, in R-05's order, named in English. */
export function neighbourhoodOptions(): { id: string; name: string }[] {
  return (["TP", "FP"] as const).map((id) => ({ id, name: englishText(`neighbourhoods.${id}`) }));
}

/** The groups the form offers (the web form's), named in English. */
export function groupOptions(): { id: string; name: string }[] {
  return SIGNUP_GROUPS.map((id) => ({ id, name: englishText(`groups.${id}.label`) }));
}

/** What a refused sign-up says to the staff member: the reason, then that nothing was sent. */
export function refusalMessage(code: SignupErrorCode | "failed"): string {
  return `${signupText(`errors.${code}`)} ${signupText("errors.nothingChanged")}`;
}
