"use client";

// Adding a place, or choosing one to correct (PRD §6.3, D9/E4; prototype R-17 to R-21), as one screen whose steps follow each other: the
// choice (R-17), the rules (R-18), the form (R-19) with its location step (R-20), and "Sent to the Hub" (R-21) with the reference code. The
// steps share one draft, kept while the resident moves between them and lost when they leave (nothing is written to the phone but a declined
// suggestion's draft handed back from R-23, read once). Nothing of the resident's saved choices is sent: their home building is read on the
// phone only to order R-17's places nearest first and to start R-20's map there (AD-3).
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { WhereRecord, DeclineReason, PlaceSubmissionErrorCode } from "@/contracts/placeSubmission";
import { PLACE_NAME_MAX_CHARS, PLACE_PHONE_MAX_CHARS, PLACE_WEB_MAX_CHARS, PLACE_WHAT_MAX_CHARS } from "@/contracts/placeSubmission";
import { LAUNCH_LANGUAGES, languageOf, type LaunchCode } from "@/i18n/languages";
import { ChoiceOption } from "../choices/parts";
import { useBuildingList, useChoices } from "../choices/use-choices";
import { listingSubcategories } from "../directory/filters";
import { useDirectory } from "../directory/use-directory";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import type { MiniMapTiles } from "../map/mini-map";
import { ResidentText } from "../text/resident-text";
import { AREA_CENTRE, CATEGORY_NOT_SURE, EMPTY_DRAFT, addBody, missingFields, nearestProviders, sendSuggestion, takeResubmit, type AddDraft, type MissingField } from "./form-model";
import { LocateStep } from "./locate";
import { Back, Honeypot, RulesCard, SentPanel, StepHeading, type RulesTexts } from "./parts";
import "../choices/choices.css";
import "../signup/signup.css";
import "./places.css";

type Step = "choose" | "rules" | "form" | "locate" | "sent";

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Where the resident lives, on this phone only: the first saved building that has a point on the map, else none. */
function useHome(buildings: { rsn: string; lat?: number; lng?: number }[] | null): { lat: number; lng: number } | null {
  const choices = useChoices();
  return useMemo(() => {
    const saved = choices?.buildings ?? [];
    const found = (buildings ?? []).find((b) => saved.includes(b.rsn) && b.lat !== undefined && b.lng !== undefined);
    return found ? { lat: found.lat!, lng: found.lng! } : null;
  }, [choices, buildings]);
}

/** The label each missing answer is listed by in R-19's "Add these, then send" box: the field's own question. */
const MISSING_LABEL: Record<MissingField, string> = { type: "R19.type", name: "R19.name", what: "R19.what", where: "R19.location" };

export function AddPlaceFlow({ lang, tiles, rules }: { lang: LaunchCode; tiles: MiniMapTiles | null; rules: Record<string, RulesTexts> }) {
  const t = useTranslations();
  const [step, setStep] = useState<Step>("choose");
  const [draft, setDraft] = useState<AddDraft>(EMPTY_DRAFT);
  const [resubmit, setResubmit] = useState<DeclineReason | null>(null);
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<PlaceSubmissionErrorCode | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [rulesLang, setRulesLang] = useState<string>(lang);

  const directory = useDirectory(lang);
  const { state: buildingState } = useBuildingList();
  const buildings = buildingState.status === "ready" ? buildingState.list.buildings : null;
  const home = useHome(buildings);
  const locale = languageOf(lang).bcp47;

  // R-23 "Change it and send again": the declined suggestion's words, handed over on this phone, open the form with the reason's note.
  useEffect(() => {
    const back = takeResubmit(sessionStore());
    if (!back) return;
    // Once, after the page is on the phone (the server renders R-17 for everyone): opening on the form is the point of the hand-over.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft({ ...EMPTY_DRAFT, ...back.draft });
    setResubmit(back.reason);
    setStep("form");
  }, []);

  const subcategories = useMemo(() => (directory.status === "ready" ? listingSubcategories(directory.listing.providers, locale) : []), [directory, locale]);
  const nearest = useMemo(() => (directory.status === "ready" ? nearestProviders(directory.listing.providers, home ?? AREA_CENTRE) : []), [directory, home]);

  const update = (change: Partial<AddDraft>) => {
    setDraft((current) => ({ ...current, ...change }));
    setRefused(null);
  };
  const missing = missingFields(draft);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (missing.length > 0 || sending) return;
    setSending(true);
    const outcome = await sendSuggestion(addBody(draft, lang));
    setSending(false);
    if (outcome.kind === "refused") return setRefused(outcome.code);
    setRef(outcome.ref);
    setStep("sent");
  };

  const restart = () => {
    setDraft(EMPTY_DRAFT);
    setResubmit(null);
    setTried(false);
    setRef(null);
    setStep("rules");
  };

  const whereText = (where: WhereRecord): string => {
    if (where.kind === "address") return where.text;
    if (where.kind === "building") {
      const address = buildings?.find((b) => b.rsn === where.rsn)?.address ?? where.rsn;
      return [address, where.text].filter(Boolean).join(". ");
    }
    return t("places.pin");
  };

  return (
    <Screen surface="resident" testId="places-add">
      {step === "choose" && (
        <Stack gap="section-resident" testId="places-choose">
          <Back href={`/${lang}/map`} />
          <StepHeading>{t("R17.title")}</StepHeading>
          <Stack gap="label">
            <button type="button" className="choice-option tap" onClick={() => setStep("rules")} data-testid="places-choose-add">
              <span className="choice-option__text">
                <span className="choice-option__label">
                  <ResidentText>{t("R17.add")}</ResidentText>
                </span>
                <span className="choice-option__line hide-basic">
                  <ResidentText>{t("R17.addLine")}</ResidentText>
                </span>
              </span>
            </button>
            <button type="button" className="choice-option tap" aria-expanded={picking} aria-controls="places-pick" onClick={() => setPicking((open) => !open)} data-testid="places-choose-correct">
              <span className="choice-option__text">
                <span className="choice-option__label">
                  <ResidentText>{t("R17.correct")}</ResidentText>
                </span>
                <span className="choice-option__line hide-basic">
                  <ResidentText>{t("R17.correctLine")}</ResidentText>
                </span>
              </span>
            </button>
          </Stack>
          {picking && (
            <section id="places-pick" aria-labelledby="places-pick-title" data-testid="places-pick">
              <Stack gap="related">
                <h2 id="places-pick-title">
                  <ResidentText>{t("R17.pickTitle")}</ResidentText>
                </h2>
                <ResidentText as="p" className="choice-hint hide-basic">
                  {t("R17.pickHint")}
                </ResidentText>
                {directory.status === "loading" && <ResidentText as="p">{t("directory.loading")}</ResidentText>}
                {directory.status === "unavailable" && <ResidentText as="p">{t("directory.couldNotLoad")}</ResidentText>}
                <Stack as="ul" gap="label">
                  {nearest.map(({ provider, km }) => (
                    <li key={provider.id}>
                      <Link className="choice-option tap" href={`/${lang}/places/correct/${provider.id}`} prefetch={false} data-testid={`places-pick-${provider.id}`}>
                        <span className="choice-option__text">
                          <span className="choice-option__label">
                            <bdi>{provider.name}</bdi>
                          </span>
                          <span className="choice-option__line">
                            <ResidentText>{t("R15.distanceHome", { d: km.toLocaleString(locale, { maximumFractionDigits: 1 }) })}</ResidentText>
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </Stack>
              </Stack>
            </section>
          )}
          <button type="button" className="choice-btn choice-btn--quiet tap" onClick={() => setStep("rules")} data-testid="places-read-rules">
            <ResidentText>{t("x03.readMore")}</ResidentText>
          </button>
        </Stack>
      )}

      {step === "rules" && (
        <Stack gap="section-resident" testId="places-rules-step">
          <Back onClick={() => setStep("choose")} />
          <Stack gap="related">
            <ResidentText as="p" className="places-steps">
              {t("R18.step")}
            </ResidentText>
            <StepHeading>{t("R18.title")}</StepHeading>
          </Stack>
          <div className="signup-field">
            <label className="choice-legend" htmlFor="places-rules-lang">
              <ResidentText>{t("R18.readIn")}</ResidentText>
            </label>
            <select id="places-rules-lang" className="choice-input" value={rulesLang} onChange={(event) => setRulesLang(event.target.value)} data-testid="places-rules-lang">
              {LAUNCH_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code} lang={language.bcp47}>
                  {language.native}
                </option>
              ))}
            </select>
            <ResidentText as="p" className="choice-hint hide-basic">
              {t("R18.readInHint")}
            </ResidentText>
          </div>
          <RulesCard
            texts={rules[rulesLang] ?? rules[lang]!}
            lang={rulesLang === lang ? undefined : languageOf(rulesLang as LaunchCode).bcp47}
            dir={rulesLang === lang ? undefined : languageOf(rulesLang as LaunchCode).dir}
          />
          <ResidentText as="p" className="hide-basic">
            {t("R18.after")}
          </ResidentText>
          <button type="button" className="choice-btn choice-btn--primary tap signup-send" onClick={() => setStep("form")} data-testid="places-rules-continue">
            <ResidentText>{t("R18.continue")}</ResidentText>
          </button>
        </Stack>
      )}

      {step === "form" && (
        <form onSubmit={submit} noValidate data-testid="places-form">
          <Stack gap="section-resident">
            <Back onClick={() => setStep("rules")} />
            <Stack gap="related">
              <ResidentText as="p" className="places-steps">
                {t("R19.step")}
              </ResidentText>
              <StepHeading>{t("R19.title")}</StepHeading>
            </Stack>
            {resubmit && (
              <p className="choice-note" role="note" data-testid="places-resubmit">
                <ResidentText>{t("R19.resubmitNote", { change: t(`R23.reasons.${resubmit}.change`) })}</ResidentText>
              </p>
            )}

            <fieldset className="choice-fieldset" aria-invalid={tried && !draft.type}>
              <ResidentText as="legend" className="choice-legend">
                {t("R19.type")}
              </ResidentText>
              <Stack gap="label">
                <ChoiceOption kind="radio" name="places-type" value="official" checked={draft.type === "official"} onChange={() => update({ type: "official" })} label={t("R19.official")} line={t("R19.officialLine")} testId="places-type-official" />
                <ChoiceOption kind="radio" name="places-type" value="offer" checked={draft.type === "offer"} onChange={() => update({ type: "offer" })} label={t("R19.offer")} line={t("R19.offerLine")} testId="places-type-offer" />
              </Stack>
            </fieldset>

            <div className="signup-field">
              <label className="choice-legend" htmlFor="places-name">
                <ResidentText>{t("R19.name")}</ResidentText>
              </label>
              <input
                id="places-name"
                className="choice-input"
                type="text"
                maxLength={PLACE_NAME_MAX_CHARS}
                placeholder={t("R19.namePh")}
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
                aria-invalid={tried && !draft.name.trim()}
                autoComplete="off"
                data-testid="places-name"
              />
            </div>

            <div className="signup-field">
              <label className="choice-legend" htmlFor="places-what">
                <ResidentText>{t("R19.what")}</ResidentText>
              </label>
              <textarea
                id="places-what"
                className="choice-input"
                rows={3}
                maxLength={PLACE_WHAT_MAX_CHARS}
                placeholder={t("R19.whatPh")}
                value={draft.what}
                onChange={(event) => update({ what: event.target.value.slice(0, PLACE_WHAT_MAX_CHARS) })}
                aria-invalid={tried && !draft.what.trim()}
                aria-describedby="places-what-count"
                data-testid="places-what"
              />
              <p className="choice-hint" id="places-what-count" aria-live="polite">
                <ResidentText>{t("R19.count", { n: draft.what.length })}</ResidentText>
              </p>
            </div>

            <div className="signup-field">
              <p className="choice-legend" id="places-where-label">
                <ResidentText>{t("R19.location")}</ResidentText>
              </p>
              {draft.where ? (
                <div className="places-card places-row" data-testid="places-where-chosen">
                  <span className="places-row__value">
                    <bdi>{whereText(draft.where)}</bdi>
                  </span>
                  <button type="button" className="choice-btn choice-btn--secondary tap" onClick={() => setStep("locate")} aria-describedby="places-where-label" data-testid="places-where-change">
                    <ResidentText>{t("R19.whereChange")}</ResidentText>
                  </button>
                </div>
              ) : (
                <>
                  <button type="button" className="choice-btn choice-btn--secondary tap" onClick={() => setStep("locate")} data-testid="places-where-open">
                    <ResidentText>{t("R19.whereBtn")}</ResidentText>
                  </button>
                  <ResidentText as="p" className="choice-hint">
                    {t("R20.noAddress")}
                  </ResidentText>
                </>
              )}
            </div>

            <div className="signup-field">
              <label className="choice-legend" htmlFor="places-category">
                <ResidentText>{t("R19.category")}</ResidentText> <span className="signup-tag">{t("R19.optional")}</span>
              </label>
              <select id="places-category" className="choice-input" value={draft.category} onChange={(event) => update({ category: event.target.value })} data-testid="places-category">
                <option value="">{t("R19.choose")}</option>
                {subcategories.map((sub) => (
                  <option key={sub.id} value={sub.name.original.body}>
                    {sub.name.body}
                  </option>
                ))}
                <option value={CATEGORY_NOT_SURE}>{t("R19.catNotSure")}</option>
              </select>
            </div>

            {(
              [
                ["phone", "places.phone", PLACE_PHONE_MAX_CHARS, "tel"],
                ["web", "places.web", PLACE_WEB_MAX_CHARS, "url"],
              ] as const
            ).map(([field, label, max, type]) => (
              <div key={field} className="signup-field">
                <label className="choice-legend" htmlFor={`places-${field}`}>
                  <ResidentText>{t(label)}</ResidentText> <span className="signup-tag">{t("R19.optional")}</span>
                </label>
                <input
                  id={`places-${field}`}
                  className="choice-input signup-phone"
                  type={type}
                  dir="ltr"
                  maxLength={max}
                  autoComplete="off"
                  value={draft[field]}
                  onChange={(event) => update({ [field]: event.target.value })}
                  aria-describedby={field === "phone" ? "places-phone-hint" : undefined}
                  data-testid={`places-${field}`}
                />
                {field === "phone" && (
                  <p className="choice-hint" id="places-phone-hint">
                    <ResidentText>{t("places.phoneHint")}</ResidentText>
                  </p>
                )}
              </div>
            ))}

            <Answers draft={draft} update={update} />

            <Honeypot value={draft.nickname} onChange={(nickname) => update({ nickname })} />

            {tried && missing.length > 0 && (
              <div className="signup-errorbox" role="alert" data-testid="places-missing">
                <ResidentText as="p">{t("R19.missingTitle")}</ResidentText>
                <ul>
                  {missing.map((field) => (
                    <ResidentText key={field} as="li">
                      {t(MISSING_LABEL[field])}
                    </ResidentText>
                  ))}
                </ul>
              </div>
            )}
            {missing.length === 0 && (
              <p role="status" data-testid="places-ready">
                <strong>
                  <ResidentText>{t("R19.ready")}</ResidentText>
                </strong>
              </p>
            )}
            {refused && (
              <p className="signup-error" role="alert" data-testid="places-refused">
                <ResidentText>{t(`places.errors.${refused}`)}</ResidentText>
              </p>
            )}
            <button type="submit" className="choice-btn choice-btn--primary tap signup-send" disabled={sending} data-testid="places-send">
              <ResidentText>{sending ? t("places.sending") : t("R19.submit")}</ResidentText>
            </button>
            <ResidentText as="p" className="choice-hint">
              {t("x03.review")}
            </ResidentText>
          </Stack>
        </form>
      )}

      {step === "locate" && (
        <LocateStep
          tiles={tiles}
          where={draft.where}
          buildings={buildings}
          home={home}
          onBack={() => setStep("form")}
          onUse={(where) => {
            update({ where });
            setStep("form");
          }}
        />
      )}

      {step === "sent" && ref && (
        <SentPanel
          lang={lang}
          title={t("R21.title")}
          lead={t("R21.youSent", { name: draft.name.trim() })}
          code={ref}
          actions={
            <>
              <Link className="choice-btn choice-btn--primary tap" href={`/${lang}/map`} prefetch={false} data-testid="places-to-map">
                <ResidentText>{t("R21.toMap")}</ResidentText>
              </Link>
              <button type="button" className="choice-btn choice-btn--secondary tap" onClick={restart} data-testid="places-another">
                <ResidentText>{t("R21.another")}</ResidentText>
              </button>
            </>
          }
        />
      )}
    </Screen>
  );
}

/** R-19's optional questions, answered by choosing ("Not sure" is a choice): the cost, ID or status, a step-free way in, the languages spoken. */
function Answers({ draft, update }: { draft: AddDraft; update: (change: Partial<AddDraft>) => void }) {
  const t = useTranslations();
  const single = <K extends "cost" | "idRequired" | "stepFree">(key: K, legend: string, options: readonly [AddDraft[K], string][]) => (
    <fieldset className="choice-fieldset" key={key}>
      <legend className="choice-legend">
        <ResidentText>{legend}</ResidentText> <span className="signup-tag">{t("R19.optional")}</span>
      </legend>
      <div className="places-chips">
        {options.map(([value, label]) => (
          <ChoiceOption key={value} kind="radio" name={`places-${key}`} value={value} checked={draft[key] === value} onChange={() => update({ [key]: value } as Partial<AddDraft>)} label={label} testId={`places-${key}-${value}`} />
        ))}
      </div>
    </fieldset>
  );
  return (
    <>
      {single("cost", t("R19.cost"), [
        ["free", t("R19.costFree")],
        ["low", t("R19.costLow")],
        ["fee", t("R19.costFee")],
        ["notSure", t("R19.notSure")],
      ])}
      {single("idRequired", t("R19.idQ"), [
        ["no", t("R19.no")],
        ["yes", t("R19.yes")],
        ["notSure", t("R19.notSure")],
      ])}
      {single("stepFree", t("R19.stepFreeQ"), [
        ["yes", t("R19.yes")],
        ["no", t("R19.no")],
        ["notSure", t("R19.notSure")],
      ])}
      <fieldset className="choice-fieldset">
        <legend className="choice-legend">
          <ResidentText>{t("R19.languagesQ")}</ResidentText> <span className="signup-tag">{t("R19.optional")}</span>
        </legend>
        <ResidentText as="p" className="choice-hint hide-basic">
          {t("R19.langsHint")}
        </ResidentText>
        <div className="places-chips">
          {LAUNCH_LANGUAGES.map((language) => {
            const on = draft.languages.includes(language.code);
            return (
              <ChoiceOption
                key={language.code}
                kind="checkbox"
                name="places-languages"
                value={language.code}
                checked={on}
                onChange={() => update({ languages: on ? draft.languages.filter((code) => code !== language.code) : [...draft.languages, language.code] })}
                label={language.native}
                labelLang={language.bcp47}
                labelDir={language.dir}
                testId={`places-language-${language.code}`}
              />
            );
          })}
        </div>
      </fieldset>
    </>
  );
}
