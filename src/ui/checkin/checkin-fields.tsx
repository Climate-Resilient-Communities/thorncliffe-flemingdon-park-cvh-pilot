"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { CHECKIN_METHODS } from "@/contracts/checkin";
import type { LaunchCode } from "@/i18n/languages";
import { ChoiceOption } from "../choices/parts";
import { Not911 } from "../emergency/not-911";
import { Stack } from "../layout/stack";
import { withIsolated } from "../text/isolated";
import { ResidentText } from "../text/resident-text";
import { moved, needsConsent, problemOf, type CheckinDraft, type HeldRequest, type WhereOption } from "./request";
import "./checkin.css";

export interface CheckinFieldsProps {
  lang: LaunchCode;
  draft: CheckinDraft;
  onChange: (draft: CheckinDraft) => void;
  /** The "where I live" choices: the buildings and floors the same form saves. */
  options: readonly WhereOption[];
  /** The edit page's request, as it was found; null on the sign-up form and when there is none. */
  held: HeldRequest | null;
  /** Show what is missing (the form was sent). */
  showProblems: boolean;
  /** The data-testid prefix of the form ("signup" or "subscription"). */
  prefix: string;
}

/**
 * The check-in request of the sign-up form and the edit page (S08.05, R-33's request as built; E08 "Check-in request"): one saved place as
 * "where I live" (a building with a floor), call or text, and, for a new request or a new place, the consent wording in the resident's
 * language (an ambassador on her floor will see her number and floor; not an emergency service; the 911 block) with its box to tick. On the
 * edit page a held request can be withdrawn ("Withdraw my check-in request"), its method changed with no new consent, and when its place is no
 * longer saved the page says it will be withdrawn and offers to ask again for the new floor. Nothing is kept on the phone.
 */
export function CheckinFields({ lang, draft, onChange, options, held, showProblems, prefix }: CheckinFieldsProps) {
  const t = useTranslations("checkin");
  const r33 = useTranslations("R33");
  const r34 = useTranslations("R34");
  const r05 = useTranslations("R05");
  const x01 = useTranslations("x01");
  const problem = showProblems ? problemOf(draft, held, options) : null;
  const update = (change: Partial<CheckinDraft>) => onChange({ ...draft, ...change });
  const away = moved(held, options);
  const consent = needsConsent(draft, held) && !(away && draft.rsn === held?.rsn && draft.floorId === held?.floorId);
  const id = `${prefix}-checkin`;

  return (
    <fieldset className="choice-fieldset signup-field checkin-fields" aria-invalid={problem !== null} data-testid={id}>
      <legend className="choice-legend">
        <ResidentText>{r33("title")}</ResidentText> <span className="signup-tag">{r05("optional")}</span>
      </legend>
      <Stack gap="target">
        <ResidentText as="p" className="choice-hint">
          {r33("what")}
        </ResidentText>
        <p className="choice-hint">
          <Link className="signup-link tap" href={`/${lang}/ready/check-in`} target="_blank" rel="noopener" data-testid={`${id}-about`}>
            <ResidentText>{r33("whatTitle")}</ResidentText>
          </Link>
        </p>
        {held !== null && away && (
          <p className="choice-note" role="note" data-testid={`${id}-moved`}>
            <ResidentText>{t("moved")}</ResidentText>
          </p>
        )}
        {held === null ? (
          <ChoiceOption kind="checkbox" name="checkin" value="ask" checked={draft.on} onChange={() => update({ on: !draft.on, agreed: false })} label={t("ask")} testId={`${id}-ask`} />
        ) : (
          <ChoiceOption kind="checkbox" name="checkin" value="withdraw" checked={!draft.on} onChange={() => update({ on: !draft.on })} label={t("withdraw")} testId={`${id}-withdraw`} />
        )}
        {held !== null && !draft.on && (
          <ResidentText as="p" className="choice-hint" testId={`${id}-withdraw-note`}>
            {t("withdrawNote")}
          </ResidentText>
        )}
        {draft.on && (
          <>
            <fieldset className="choice-fieldset" data-testid={`${id}-where`}>
              <legend className="choice-legend">
                <ResidentText>{r34("whereLive")}</ResidentText>
              </legend>
              <Stack gap="target">
                {options.length === 0 ? (
                  <ResidentText as="p" className="choice-note" testId={`${id}-no-place`}>
                    {r33("needPlace")}
                  </ResidentText>
                ) : (
                  <>
                    <ResidentText as="p" className="choice-hint">
                      {t("whereHint")}
                    </ResidentText>
                    <Stack gap="target" as="ul">
                      {options.map((option) => (
                        <li key={`${option.rsn}:${option.floorId}`}>
                          <ChoiceOption
                            kind="radio"
                            name={`${id}-where`}
                            value={`${option.rsn}:${option.floorId}`}
                            checked={draft.rsn === option.rsn && draft.floorId === option.floorId}
                            onChange={() => update({ rsn: option.rsn, floorId: option.floorId })}
                            label={withIsolated((building) => r33("placeLine", { building, floor: option.floorLabel }), option.address)}
                            testId={`${id}-where-${option.floorId}`}
                          />
                        </li>
                      ))}
                    </Stack>
                  </>
                )}
                {problem === "place" && options.length > 0 && (
                  <p className="signup-error" data-testid={`${id}-error-place`}>
                    <ResidentText>{r33("needPlace")}</ResidentText>
                  </p>
                )}
              </Stack>
            </fieldset>
            <fieldset className="choice-fieldset" data-testid={`${id}-method`}>
              <legend className="choice-legend">
                <ResidentText>{r33("how")}</ResidentText>
              </legend>
              <Stack gap="target">
                {CHECKIN_METHODS.map((method) => (
                  <ChoiceOption key={method} kind="radio" name={`${id}-method`} value={method} checked={draft.method === method} onChange={() => update({ method })} label={r33(method)} testId={`${id}-method-${method}`} />
                ))}
                {problem === "method" && (
                  <p className="signup-error" data-testid={`${id}-error-method`}>
                    <ResidentText>{r33("needMethod")}</ResidentText>
                  </p>
                )}
              </Stack>
            </fieldset>
            {consent && (
              <section className="checkin-consent" aria-labelledby={`${id}-consent-title`} data-testid={`${id}-consent`}>
                <Stack gap="target">
                  <h3 id={`${id}-consent-title`} className="choice-legend">
                    <ResidentText>{r33("whatTitle")}</ResidentText>
                  </h3>
                  <ResidentText as="p" className="checkin-consent__sees" testId={`${id}-sees`}>
                    {t("sees")}
                  </ResidentText>
                  <ResidentText as="p">{r33("notEmergency")}</ResidentText>
                  <Not911 variant="block" t={(key) => x01(key)} />
                  <ChoiceOption kind="checkbox" name={`${id}-agree`} value="agreed" checked={draft.agreed} onChange={() => update({ agreed: !draft.agreed })} label={t("agree")} testId={`${id}-agree`} />
                  {problem === "consent" && (
                    <p className="signup-error" data-testid={`${id}-error-consent`}>
                      <ResidentText>{t("consentMissing")}</ResidentText>
                    </p>
                  )}
                </Stack>
              </section>
            )}
          </>
        )}
      </Stack>
    </fieldset>
  );
}
