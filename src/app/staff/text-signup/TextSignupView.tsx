import type { ReactNode } from "react";
import { FALLBACK_MARKER, ResidentText, Stack } from "@/ui";
import { TEXT_SIGNUP_PAGE, signupText, type LanguageOption } from "./view";

/** One text of the terms as the page shows it: a translation, or English standing in for a missing one. */
export interface TermsLineView {
  text: string;
  unavailable: boolean;
}

/** What the Text sign-up page shows, step by step. */
export type TextSignupModel =
  | { step: "unavailable" }
  | { step: "language"; languages: readonly LanguageOption[] }
  | {
      step: "form";
      /** The resident's language, named in English. */
      language: string;
      /** The terms and privacy page in the resident's language (its sections), with the language's tag and direction. */
      terms: { draft: boolean; bcp47: string; dir: "ltr" | "rtl"; sections: readonly { id: string; heading: TermsLineView; lines: readonly TermsLineView[] }[] };
      consentVersion: string;
    };

/** One text of the terms as the whole content of its element: English standing in for a missing translation is marked and set left to right. */
function TermsLine({ text, as }: { text: TermsLineView; as: "h3" | "p" }) {
  return (
    <ResidentText as={as} fallback={text.unavailable}>
      {text.unavailable ? FALLBACK_MARKER + text.text : text.text}
    </ResidentText>
  );
}

/**
 * The Text sign-up page's body (S07.03), as it is drawn: the heading, then the step. First the resident's language, as links; then the terms and
 * privacy page in that language, set apart so the staff member can read it out or turn the screen to the resident, and the form (`form`, the
 * client component on the page, its behaviour-free view in the tests). It holds no behaviour and reads nothing.
 */
export function TextSignupView({ model, form }: { model: TextSignupModel; form?: ReactNode }) {
  return (
    <Stack gap="section-hub" testId="text-signup">
      <Stack gap="related">
        <h1>{signupText("title")}</h1>
        <p>{signupText("lead")}</p>
      </Stack>
      {model.step === "unavailable" ? (
        <p className="hub-flag" role="status" data-testid="text-signup-unavailable">
          {signupText("unavailable")}
        </p>
      ) : model.step === "language" ? (
        <Stack gap="related">
          <h2>{signupText("languageHeading")}</h2>
          <p>{signupText("languageLead")}</p>
          <Stack gap="target" as="ul" testId="text-signup-languages">
            {model.languages.map((option) => (
              <li key={option.code}>
                <a className="tap hub-link" href={option.href}>
                  <span>
                    {option.name}
                    {option.native ? (
                      <>
                        {" ("}
                        <bdi lang={option.native.bcp47} dir={option.native.dir}>
                          {option.native.text}
                        </bdi>
                        {")"}
                      </>
                    ) : null}
                  </span>
                </a>
              </li>
            ))}
          </Stack>
        </Stack>
      ) : (
        <>
          <Stack gap="related">
            <p data-testid="text-signup-language">{signupText("languageChosen", { language: model.language })}</p>
            <p>
              <a className="tap hub-link" href={TEXT_SIGNUP_PAGE}>{signupText("changeLanguage")}</a>
            </p>
          </Stack>
          <section aria-labelledby="text-signup-terms-heading">
            <Stack gap="stack">
              <Stack gap="related">
                <h2 id="text-signup-terms-heading">{signupText("termsHeading")}</h2>
                <p>{signupText("termsLead", { language: model.language })}</p>
                {model.terms.sections.some((s) => s.heading.unavailable || s.lines.some((line) => line.unavailable)) ? (
                  <p className="hub-flag" role="note" data-testid="text-signup-terms-english">
                    {signupText("termsEnglish", { language: model.language })}
                  </p>
                ) : null}
                {model.terms.draft ? (
                  <p className="hub-flag" role="note" data-testid="text-signup-terms-draft">
                    {signupText("termsDraft")}
                  </p>
                ) : null}
              </Stack>
              <div className="hub-resident-words" lang={model.terms.bcp47} dir={model.terms.dir} data-testid="text-signup-terms">
                <Stack gap="stack">
                  {model.terms.sections.map((section) => (
                    <Stack gap="related" key={section.id}>
                      <TermsLine text={section.heading} as="h3" />
                      {section.lines.map((line, index) => (
                        <TermsLine key={index} text={line} as="p" />
                      ))}
                    </Stack>
                  ))}
                </Stack>
              </div>
              <small>{signupText("termsVersion", { version: model.consentVersion })}</small>
            </Stack>
          </section>
          {form}
        </>
      )}
    </Stack>
  );
}
