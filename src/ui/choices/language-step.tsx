"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LaunchCode } from "@/i18n/languages";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { ResidentText } from "../text/resident-text";
import { baseChoices, choicesStore } from "./choices-store";
import { ChoiceButton, ChoiceOption, StepActions, type StepMode } from "./parts";

export type StepLanguage = { code: LaunchCode; bcp47: string; dir: "ltr" | "rtl"; native: string };

export type LanguageStepProps = {
  /** The language of the page. */
  lang: LaunchCode;
  mode: StepMode;
  languages: readonly StepLanguage[];
};

/**
 * R-01: choose the language, the first of the first-run steps (and, opened from R-34, a way to change it). Each
 * language is shown in its own name and script. Continuing saves the language in device choices and opens the next
 * screen under that language's URL, so the page, its direction and its font follow.
 */
export function LanguageStep({ lang, mode, languages }: LanguageStepProps) {
  const t = useTranslations("R01");
  const shell = useTranslations("shell");
  const save = useTranslations("R35");
  const router = useRouter();
  const [picked, setPicked] = useState<LaunchCode>(lang);

  const next = (code: LaunchCode) => (mode === "first-run" ? `/${code}/welcome/groups` : `/${code}/choices`);

  const proceed = () => {
    choicesStore.update((current) => ({ ...baseChoices(current), lang: picked }));
    // A different language is a full page load: <html lang dir> and the font are set by the layout.
    if (picked !== lang) window.location.assign(next(picked));
    else router.push(next(picked));
  };

  return (
    <Screen surface="resident" testId="step-language">
      <Stack gap="stack">
        <ResidentText as="h1">{t("title")}</ResidentText>
        <fieldset className="choice-fieldset">
          <legend className="sr-only">
            <ResidentText>{t("title")}</ResidentText>
          </legend>
          <Stack gap="target" as="ul">
            {languages.map((language) => (
              <li key={language.code}>
                <ChoiceOption
                  kind="radio"
                  name="language"
                  value={language.code}
                  checked={picked === language.code}
                  onChange={() => setPicked(language.code)}
                  label={language.native}
                  labelLang={language.bcp47}
                  labelDir={language.dir}
                  testId={`language-${language.code}`}
                />
              </li>
            ))}
          </Stack>
        </fieldset>
        {mode === "first-run" ? (
          <StepActions>
            <ChoiceButton variant="primary" onClick={proceed} testId="step-continue">
              {shell("next")}
            </ChoiceButton>
          </StepActions>
        ) : (
          <StepActions>
            <ChoiceButton variant="secondary" onClick={() => router.push(`/${lang}/choices`)} testId="step-cancel">
              {shell("cancel")}
            </ChoiceButton>
            <ChoiceButton variant="primary" onClick={proceed} testId="step-save">
              {save("save")}
            </ChoiceButton>
          </StepActions>
        )}
      </Stack>
    </Screen>
  );
}
