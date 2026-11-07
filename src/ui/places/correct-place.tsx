"use client";

// R-22 "Correct this place" (PRD §6.3, D9/E4): the listed place, read from the same downloaded release as its own page, one row per thing the
// resident may change (its name, where it is, its phone and website, and three of R-19's questions), each with Change; a changed row says
// what it was and can be undone. Only the changed rows are sent (R22.onlyThis); then the sent state with the reference code.
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { ListingProvider } from "@/contracts/directory";
import type { CorrectionField, PlaceSubmissionErrorCode } from "@/contracts/placeSubmission";
import { PLACE_NAME_MAX_CHARS, PLACE_PHONE_MAX_CHARS, PLACE_WEB_MAX_CHARS, PLACE_WHERE_TEXT_MAX_CHARS } from "@/contracts/placeSubmission";
import type { LaunchCode } from "@/i18n/languages";
import { ChoiceOption } from "../choices/parts";
import { CallHub } from "../directory/call-hub";
import { useDirectory } from "../directory/use-directory";
import { addressLines } from "../directory/provider-view";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { ResidentText } from "../text/resident-text";
import { correctionBody, sendSuggestion, type CorrectionDraft } from "./form-model";
import { Back, Honeypot, RulesCard, SentPanel, StepHeading, type RulesTexts } from "./parts";
import "../choices/choices.css";
import "../signup/signup.css";
import "./places.css";

type Row =
  | { field: CorrectionField; kind: "text"; label: string; was: string | null; max: number; inputType: "text" | "tel" | "url" }
  | { field: CorrectionField; kind: "choice"; label: string; was: string | null; options: readonly [string, string][] };

/** The rows of R-22 for a listed place, with what the release says now (null: not known; the release has no cost, ID or step-free answer). */
function rowsOf(provider: ListingProvider, t: ReturnType<typeof useTranslations>): Row[] {
  const yesNo: [string, string][] = [
    ["yes", t("R19.yes")],
    ["no", t("R19.no")],
    ["notSure", t("R19.notSure")],
  ];
  return [
    { field: "name", kind: "text", label: t("R22.namePlace"), was: provider.name, max: PLACE_NAME_MAX_CHARS, inputType: "text" },
    { field: "where", kind: "text", label: t("R22.whereLabel"), was: addressLines(provider)[0] ?? null, max: PLACE_WHERE_TEXT_MAX_CHARS, inputType: "text" },
    { field: "phone", kind: "text", label: t("places.phone"), was: provider.contact.phone.find((p) => p.trim() !== "") ?? null, max: PLACE_PHONE_MAX_CHARS, inputType: "tel" },
    { field: "web", kind: "text", label: t("places.web"), was: provider.contact.web.find((w) => w.trim() !== "") ?? null, max: PLACE_WEB_MAX_CHARS, inputType: "url" },
    {
      field: "cost",
      kind: "choice",
      label: t("R19.cost"),
      was: null,
      options: [
        ["free", t("R19.costFree")],
        ["low", t("R19.costLow")],
        ["fee", t("R19.costFee")],
        ["notSure", t("R19.notSure")],
      ],
    },
    { field: "idRequired", kind: "choice", label: t("R19.idQ"), was: null, options: yesNo },
    { field: "stepFree", kind: "choice", label: t("R19.stepFreeQ"), was: null, options: yesNo },
  ];
}

export function CorrectPlace({ lang, id, rules }: { lang: LaunchCode; id: string; rules: RulesTexts }) {
  const t = useTranslations();
  const directory = useDirectory(lang);
  const provider = directory.status === "ready" ? (directory.listing.providers.find((p) => p.id === id) ?? null) : null;
  const [changes, setChanges] = useState<CorrectionDraft>({});
  const [editing, setEditing] = useState<CorrectionField | null>(null);
  const [draftText, setDraftText] = useState("");
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<PlaceSubmissionErrorCode | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [showRules, setShowRules] = useState(false);

  const back = `/${lang}/directory/${id}`;
  if (directory.status !== "ready" || !provider) {
    return (
      <Screen surface="resident" testId="places-correct">
        <Stack gap="section-resident">
          <Back href={back} />
          {directory.status === "loading" && <ResidentText as="p">{t("directory.loading")}</ResidentText>}
          {directory.status === "unavailable" && (
            <Stack gap="related">
              <ResidentText as="h1">{t("directory.couldNotLoad")}</ResidentText>
              <CallHub testId="places-call-hub" />
            </Stack>
          )}
          {directory.status === "ready" && (
            <ResidentText as="h1" testId="places-correct-not-found">
              {t("R12.notFound")}
            </ResidentText>
          )}
        </Stack>
      </Screen>
    );
  }

  const rows = rowsOf(provider, t);
  const shown = (row: Row, value: string | null | undefined): string => {
    if (value === null || value === undefined || value === "") return t("R12.unknown");
    if (row.kind === "choice") return row.options.find(([v]) => v === value)?.[1] ?? value;
    return value;
  };
  const set = (field: CorrectionField, value: string | undefined) => {
    setChanges((current) => {
      const next = { ...current };
      if (value === undefined) delete next[field];
      else next[field] = value;
      return next;
    });
    setRefused(null);
  };
  const count = Object.keys(changes).length;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (count === 0 || sending) return;
    setSending(true);
    const outcome = await sendSuggestion(correctionBody({ id: provider.id, name: provider.name }, changes, lang, nickname));
    setSending(false);
    if (outcome.kind === "refused") return setRefused(outcome.code);
    setRef(outcome.ref);
  };

  if (ref) {
    return (
      <Screen surface="resident" testId="places-correct">
        <SentPanel
          lang={lang}
          title={t("R22.sentTitle")}
          lead={t("R22.sent")}
          code={ref}
          actions={
            <>
              <Link className="choice-btn choice-btn--primary tap" href={back} prefetch={false} data-testid="places-to-place">
                <ResidentText>{t("R22.toPlace")}</ResidentText>
              </Link>
              <Link className="choice-btn choice-btn--secondary tap" href={`/${lang}/map`} prefetch={false} data-testid="places-to-map">
                <ResidentText>{t("R22.toMap")}</ResidentText>
              </Link>
            </>
          }
        >
          <section className="places-card" aria-labelledby="places-changed-title" data-testid="places-changed">
            <Stack gap="related">
              <h2 id="places-changed-title">
                <ResidentText>{t("R22.whatChanged")}</ResidentText>
              </h2>
              <p className="choice-hint">
                <bdi>{provider.name}</bdi>
              </p>
              {rows
                .filter((row) => changes[row.field] !== undefined)
                .map((row) => (
                  <div key={row.field} className="places-row__value">
                    <span className="places-label">
                      <ResidentText>{row.label}</ResidentText>
                    </span>
                    <bdi>{shown(row, changes[row.field])}</bdi>
                    <span className="places-was">
                      <ResidentText>{t("R22.was", { v: shown(row, row.was) })}</ResidentText>
                    </span>
                  </div>
                ))}
            </Stack>
          </section>
        </SentPanel>
      </Screen>
    );
  }

  return (
    <Screen surface="resident" testId="places-correct">
      <form onSubmit={submit} noValidate data-testid="places-correct-form">
        <Stack gap="section-resident">
          <Back href={back} />
          <Stack gap="related">
            <StepHeading>{t("R22.title")}</StepHeading>
            <p className="signup-lead">
              <bdi>{provider.name}</bdi>
            </p>
            <ResidentText as="p">{t("R22.changeOne")}</ResidentText>
          </Stack>
          <div>
            {rows.map((row) => {
              const changed = changes[row.field] !== undefined;
              const open = editing === row.field;
              return (
                <div key={row.field} className="places-row" data-testid={`places-row-${row.field}`}>
                  <div className="places-row__value">
                    <span className="places-label" id={`places-row-${row.field}-label`}>
                      <ResidentText>{row.label}</ResidentText>
                    </span>
                    {!open && <bdi>{shown(row, changed ? changes[row.field] : row.was)}</bdi>}
                    {!open && changed && (
                      <>
                        <span className="places-was">
                          <ResidentText>{t("R22.was", { v: shown(row, row.was) })}</ResidentText>
                        </span>
                        <span className="places-tag">
                          <ResidentText>{t("R22.changedTag")}</ResidentText>
                        </span>
                      </>
                    )}
                    {open && row.kind === "text" && (
                      <input
                        className="choice-input"
                        type={row.inputType}
                        dir={row.inputType === "text" ? "auto" : "ltr"}
                        maxLength={row.max}
                        value={draftText}
                        onChange={(event) => setDraftText(event.target.value)}
                        aria-labelledby={`places-row-${row.field}-label`}
                        data-testid={`places-input-${row.field}`}
                        autoFocus
                      />
                    )}
                    {open && row.kind === "choice" && (
                      <fieldset className="choice-fieldset" aria-labelledby={`places-row-${row.field}-label`}>
                        <div className="places-chips">
                          {row.options.map(([value, label]) => (
                            <ChoiceOption
                              key={value}
                              kind="radio"
                              name={`places-${row.field}`}
                              value={value}
                              checked={(changes[row.field] ?? row.was) === value}
                              onChange={() => {
                                set(row.field, value === row.was ? undefined : value);
                                setEditing(null);
                              }}
                              label={label}
                              testId={`places-${row.field}-${value}`}
                            />
                          ))}
                        </div>
                      </fieldset>
                    )}
                    {open && (
                      <button
                        type="button"
                        className="choice-btn choice-btn--secondary tap"
                        onClick={() => {
                          if (row.kind === "text") {
                            const text = draftText.trim();
                            set(row.field, text && text !== row.was ? text : undefined);
                          }
                          setEditing(null);
                        }}
                        data-testid={`places-done-${row.field}`}
                      >
                        <ResidentText>{t("R22.doneEditing")}</ResidentText>
                      </button>
                    )}
                  </div>
                  {!open && !changed && editing === null && (
                    <button
                      type="button"
                      className="choice-btn choice-btn--secondary tap"
                      aria-label={`${t("R22.change")}: ${row.label}`}
                      onClick={() => {
                        setDraftText(row.kind === "text" ? (row.was ?? "") : "");
                        setEditing(row.field);
                      }}
                      data-testid={`places-change-${row.field}`}
                    >
                      <ResidentText>{t("R22.change")}</ResidentText>
                    </button>
                  )}
                  {!open && changed && (
                    <button type="button" className="choice-btn choice-btn--quiet tap" aria-label={`${t("R22.undo")}: ${row.label}`} onClick={() => set(row.field, undefined)} data-testid={`places-undo-${row.field}`}>
                      <ResidentText>{t("R22.undo")}</ResidentText>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <ResidentText as="p" className="places-market">
            {t("x03.market")}
          </ResidentText>
          <button type="button" className="choice-btn choice-btn--quiet tap" aria-expanded={showRules} onClick={() => setShowRules((open) => !open)} data-testid="places-read-rules">
            <ResidentText>{t("x03.readMore")}</ResidentText>
          </button>
          {showRules && <RulesCard texts={rules} />}
          <Honeypot value={nickname} onChange={setNickname} />
          {tried && count === 0 && (
            <p className="signup-error" role="alert" data-testid="places-nothing-yet">
              <ResidentText>{t("R22.nothingYet")}</ResidentText>
            </p>
          )}
          {refused && (
            <p className="signup-error" role="alert" data-testid="places-refused">
              <ResidentText>{t(`places.errors.${refused}`)}</ResidentText>
            </p>
          )}
          <button type="submit" className="choice-btn choice-btn--primary tap signup-send" disabled={sending || editing !== null} data-testid="places-send">
            <ResidentText>{sending ? t("places.sending") : t("R22.submit")}</ResidentText>
          </button>
          <ResidentText as="p" className="choice-hint hide-basic">
            {t("R22.onlyThis")}
          </ResidentText>
        </Stack>
      </form>
    </Screen>
  );
}
