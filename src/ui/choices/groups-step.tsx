"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GROUPS, type Group } from "@/contracts/groups";
import type { LaunchCode } from "@/i18n/languages";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { ResidentText } from "../text/resident-text";
import { baseChoices, choicesStore } from "./choices-store";
import { ChoiceButton, ChoiceOption, StepActions, type StepMode } from "./parts";
import { useChoices } from "./use-choices";

/**
 * R-26: which groups the resident belongs to. Any number, none is fine, and nothing is asked about why. The choice
 * is saved on the phone only. In the first run it can be skipped; opened from R-34 it saves or cancels.
 */
export function GroupsStep({ lang, mode }: { lang: LaunchCode; mode: StepMode }) {
  const t = useTranslations("R26");
  const groups = useTranslations("groups");
  const shell = useTranslations("shell");
  const router = useRouter();
  const choices = useChoices();
  const [draft, setDraft] = useState<readonly Group[] | null>(null);
  const picked = draft ?? choices?.groups ?? [];

  const toggle = (group: Group) => setDraft(picked.includes(group) ? picked.filter((g) => g !== group) : GROUPS.filter((g) => g === group || picked.includes(g)));

  const done = (save: boolean) => {
    if (save) choicesStore.update((current) => ({ ...baseChoices(current), groups: [...picked] }));
    router.push(mode === "first-run" ? `/${lang}/welcome/place` : `/${lang}/choices`);
  };

  return (
    <Screen surface="resident" testId="step-groups">
      <Stack gap="stack">
        <Stack gap="label">
          {mode === "first-run" && (
            <p className="choice-hint">
              <ResidentText>{t("step")}</ResidentText>
            </p>
          )}
          <ResidentText as="h1">{t("title")}</ResidentText>
          <ResidentText as="p">{t("lead")}</ResidentText>
        </Stack>
        <fieldset className="choice-fieldset">
          <legend className="sr-only">
            <ResidentText>{t("choose")}</ResidentText>
          </legend>
          <Stack gap="target" as="ul">
            {GROUPS.map((group) => (
              <li key={group}>
                <ChoiceOption
                  kind="checkbox"
                  name="groups"
                  value={group}
                  checked={picked.includes(group)}
                  onChange={() => toggle(group)}
                  label={groups(`${group}.label`)}
                  line={groups(`${group}.line`)}
                  testId={`group-${group}`}
                />
              </li>
            ))}
          </Stack>
        </fieldset>
        {mode === "first-run" ? (
          <Stack gap="label">
            <StepActions>
              <ChoiceButton variant="secondary" onClick={() => done(false)} testId="step-skip">
                {shell("skip")}
              </ChoiceButton>
              <ChoiceButton variant="primary" onClick={() => done(true)} testId="step-continue">
                {shell("next")}
              </ChoiceButton>
            </StepActions>
            <p className="choice-hint">
              <ResidentText>{t("skipLine")}</ResidentText>
            </p>
          </Stack>
        ) : (
          <StepActions>
            <ChoiceButton variant="secondary" onClick={() => done(false)} testId="step-cancel">
              {shell("cancel")}
            </ChoiceButton>
            <ChoiceButton variant="primary" onClick={() => done(true)} testId="step-save">
              {t("save")}
            </ChoiceButton>
          </StepActions>
        )}
      </Stack>
    </Screen>
  );
}
