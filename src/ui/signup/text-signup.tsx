"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { BuildingList } from "@/contracts/buildingList";
import { displayPhone } from "@/contracts/phone";
import {
  SIGNUP_CONTRACT_VERSION,
  SIGNUP_ERROR_CODES,
  SIGNUP_GROUPS,
  canadianNumber,
  presetNeighbourhood,
  type SignupErrorCode,
  type SignupRequestBody,
} from "@/contracts/signup";
import type { LaunchCode } from "@/i18n/languages";
import { sortBuildings } from "../choices/building-list";
import { ChoiceButton, ChoiceOption } from "../choices/parts";
import type { StepLanguage } from "../choices/language-step";
import { useBuildingList, useChoices } from "../choices/use-choices";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { withIsolated } from "../text/isolated";
import { ResidentText } from "../text/resident-text";
import "../choices/choices.css";
import "./signup.css";

/** The two pilot neighbourhoods, in the order R-05 shows them, each with its name in the page's language. */
export interface SignupNeighbourhood {
  id: string;
  name: string;
}

export interface TextSignupProps {
  lang: LaunchCode;
  languages: readonly StepLanguage[];
  neighbourhoods: readonly SignupNeighbourhood[];
  /** The terms version the form shows and the sign-up records. */
  consentVersion: string;
  /** True outside production while the terms are a draft (the form says so, as the terms page does). */
  termsDraft: boolean;
  /** The number the texts come from (E.164), to text START to; null where it is not configured. */
  textNumber: string | null;
  /** Test seam: where the form is sent. */
  endpoint?: string;
}

type Field = "phone" | "nbhd" | "terms" | "age";

interface Draft {
  phone: string;
  nbhd: string | null;
  lang: LaunchCode;
  buildings: string[];
  floors: string[];
  groups: string[];
}

const textMatches = (text: string, query: string) => text.toLowerCase().includes(query.trim().toLowerCase());

const isErrorCode = (value: unknown): value is SignupErrorCode => typeof value === "string" && (SIGNUP_ERROR_CODES as readonly string[]).includes(value);

/** The places the form sends: each chosen building with its chosen floors (floors of a building the list does not know are kept as saved). */
function placesOf(draft: Draft, list: BuildingList | null): SignupRequestBody["places"] {
  return draft.buildings.map((rsn) => {
    const listed = list?.buildings.find((b) => b.rsn === rsn);
    const floors = listed ? listed.floors.map((f) => f.id).filter((id) => draft.floors.includes(id)) : [];
    return { rsn, floors };
  });
}

/**
 * R-05 "Get text alerts" and, once sent, R-06 (what to expect, how to stop, how to change choices). The form starts from the choices saved
 * on this phone (language, buildings, floors, groups), never writes them back, and asks for the number. The neighbourhood is chosen for the
 * resident only when every saved building is in one neighbourhood. Nothing is stored on the phone: not the number, not that a sign-up was
 * sent. The POST is the one resident request that carries places and groups; it sets no cookie.
 */
export function TextSignup({ lang, languages, neighbourhoods, consentVersion, termsDraft, textNumber, endpoint = "/api/signup" }: TextSignupProps) {
  const t = useTranslations("signup");
  const r05 = useTranslations("R05");
  const r34 = useTranslations("R34");
  const r35 = useTranslations("R35");
  const groupText = useTranslations("groups");
  const terms = useTranslations("terms");
  const choices = useChoices();
  const { state, retry } = useBuildingList();
  const list = state.status === "ready" ? state.list : null;

  // What the resident changed; everything else comes from the phone's choices, read once they are known (undefined until then).
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<"form" | "sending" | "sent">("form");
  const [serverError, setServerError] = useState<SignupErrorCode | "network" | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef<HTMLHeadingElement>(null);

  const draft = useMemo((): Draft | null => {
    if (choices === undefined) return null;
    const saved = choices ?? { v: 1 as const };
    const deviceLang = languages.some((l) => l.code === saved.lang) ? (saved.lang as LaunchCode) : lang;
    // The neighbourhood is pre-selected only when every saved building is in the same one (known once the building list has loaded).
    const preset = list ? presetNeighbourhood(saved.buildings ?? [], (rsn) => list.buildings.find((b) => b.rsn === rsn)?.neighbourhoodId) : null;
    return {
      phone: "",
      nbhd: preset !== null && neighbourhoods.some((n) => n.id === preset) ? preset : null,
      lang: deviceLang,
      buildings: [...(saved.buildings ?? [])],
      floors: [...(saved.floors ?? [])],
      groups: (saved.groups ?? []).filter((g) => (SIGNUP_GROUPS as readonly string[]).includes(g)),
      ...edits,
    };
  }, [choices, edits, lang, languages, list, neighbourhoods]);

  useEffect(() => {
    // R-06 starts at its heading, wherever the form was scrolled to when it was sent.
    if (status !== "sent") return;
    sentRef.current?.scrollIntoView({ block: "start" });
    sentRef.current?.focus({ preventScroll: true });
  }, [status]);

  const shown = useMemo(() => {
    if (!list || query.trim() === "") return [];
    return sortBuildings(list.buildings).filter((b) => !draft?.buildings.includes(b.rsn) && (textMatches(b.address, query) || textMatches(b.neighbourhood, query)));
  }, [list, query, draft]);

  if (draft === null) {
    return (
      <Screen surface="resident" testId="text-signup">
        <ResidentText as="h1">{r05("title")}</ResidentText>
      </Screen>
    );
  }

  const phone = canadianNumber(draft.phone);
  const problems: Field[] = [];
  if (phone === null) problems.push("phone");
  if (draft.nbhd === null) problems.push("nbhd");
  if (!termsAgreed) problems.push("terms");
  if (!ageConfirmed) problems.push("age");
  const shows = (field: Field) => submitted && problems.includes(field);
  const missingWords: Record<Field, string> = { phone: r05("missingPhone"), nbhd: r05("missingNbhd"), terms: t("missingTerms"), age: t("missingAge") };

  const update = (change: Partial<Draft>) => setEdits({ ...edits, ...change });
  const toggleBuilding = (rsn: string, floorIds: readonly string[]) => {
    if (draft.buildings.includes(rsn)) update({ buildings: draft.buildings.filter((r) => r !== rsn), floors: draft.floors.filter((id) => !floorIds.includes(id)) });
    else {
      update({ buildings: [...draft.buildings, rsn] });
      setQuery("");
    }
  };
  const toggleFloor = (id: string) => update({ floors: draft.floors.includes(id) ? draft.floors.filter((f) => f !== id) : [...draft.floors, id] });
  const toggleGroup = (group: string) => update({ groups: draft.groups.includes(group) ? draft.groups.filter((g) => g !== group) : [...draft.groups, group] });

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (problems.length > 0 || draft.nbhd === null) {
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    const body: SignupRequestBody = {
      v: SIGNUP_CONTRACT_VERSION,
      phone: draft.phone,
      lang: draft.lang,
      neighbourhood: draft.nbhd,
      places: placesOf(draft, list),
      groups: SIGNUP_GROUPS.filter((g) => draft.groups.includes(g)),
      consent_version: consentVersion,
      terms_agreed: termsAgreed,
      age_confirmed: ageConfirmed,
    };
    setStatus("sending");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit", cache: "no-store" });
      if (response.status === 202) {
        setStatus("sent");
        return;
      }
      const answer = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
      setServerError(isErrorCode(answer?.error?.code) ? answer.error.code : "signup_unavailable");
    } catch {
      setServerError("network");
    }
    setStatus("form");
    requestAnimationFrame(() => errorRef.current?.focus());
  };

  if (status === "sent") {
    return (
      <Screen surface="resident" testId="text-signup-sent">
        <Stack gap="stack">
          <section className="signup-sent" role="status" aria-labelledby="signup-sent-title" data-testid="signup-sent">
            <Stack gap="related">
              <h1 id="signup-sent-title" tabIndex={-1} ref={sentRef}>
                <ResidentText>{r05("sentTitle")}</ResidentText>
              </h1>
              <ResidentText as="p" className="signup-lead" testId="signup-on-its-way">
                {t("onItsWay")}
              </ResidentText>
              <ResidentText as="p" testId="signup-expect">
                {t("expect")}
              </ResidentText>
            </Stack>
          </section>
          <Stack gap="related">
            <ResidentText as="p" testId="signup-how-stop">
              {r05("howStop")}
            </ResidentText>
            <ResidentText as="p" testId="signup-how-change">
              {t("howChange")}
            </ResidentText>
            <p className="choice-note" data-testid="signup-start-help">
              {textNumber ? withIsolated((number) => t("startHelp", { number }), displayPhone(textNumber)) : <ResidentText>{t("startHelpNoNumber")}</ResidentText>}
            </p>
          </Stack>
          <div className="choice-actions">
            <ChoiceButton
              variant="secondary"
              onClick={() => {
                setStatus("form");
                setSubmitted(false);
              }}
              testId="signup-fix"
            >
              {r05("fix")}
            </ChoiceButton>
            <Link className="choice-btn choice-btn--primary tap" href={`/${lang}`} data-testid="signup-home">
              <ResidentText>{r05("toHome")}</ResidentText>
            </Link>
          </div>
          <p className="choice-hint">
            <ResidentText>{r05("noAccount")}</ResidentText>
          </p>
        </Stack>
      </Screen>
    );
  }

  const errorBox = submitted && problems.length > 0 ? r05("formError", { missing: problems.map((p) => missingWords[p]).join(r05("and")) }) : serverError ? t(`error.${serverError}`) : null;

  return (
    <Screen surface="resident" testId="text-signup">
      <form onSubmit={send} noValidate data-testid="signup-form">
        <Stack gap="stack">
          <Stack gap="label">
            <ResidentText as="h1">{r05("title")}</ResidentText>
            <ResidentText as="p">{r05("lead")}</ResidentText>
          </Stack>

          {errorBox !== null && (
            <div className="signup-errorbox" role="alert" tabIndex={-1} ref={errorRef} data-testid="signup-errorbox">
              <ResidentText as="p">{errorBox}</ResidentText>
            </div>
          )}

          <div className="signup-field">
            <label className="choice-legend" htmlFor="signup-phone">
              <ResidentText>{r05("phone")}</ResidentText> <span className="signup-tag">{r05("required")}</span>
            </label>
            <ResidentText as="p" className="choice-hint">
              {r05("phoneHelp")}
            </ResidentText>
            <input
              id="signup-phone"
              className="choice-input signup-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              value={draft.phone}
              onChange={(event) => update({ phone: event.target.value })}
              aria-invalid={shows("phone")}
              aria-describedby={shows("phone") ? "signup-phone-error" : undefined}
              data-testid="signup-phone"
            />
            {phone !== null && (
              <p className="choice-hint" data-testid="signup-phone-shown">
                {withIsolated((p) => r05("phoneShown", { phone: p }), displayPhone(phone))}
              </p>
            )}
            {shows("phone") && (
              <p className="signup-error" id="signup-phone-error" data-testid="signup-error-phone">
                <ResidentText>{t("error.phone_not_canadian")}</ResidentText>
              </p>
            )}
          </div>

          <fieldset className="choice-fieldset signup-field" aria-invalid={shows("nbhd")} data-testid="signup-nbhd">
            <legend className="choice-legend">
              <ResidentText>{r05("nbhd")}</ResidentText> <span className="signup-tag">{r05("required")}</span>
            </legend>
            <Stack gap="target">
              {neighbourhoods.map((n) => (
                <ChoiceOption
                  key={n.id}
                  kind="radio"
                  name="nbhd"
                  value={n.id}
                  checked={draft.nbhd === n.id}
                  onChange={() => update({ nbhd: n.id })}
                  label={n.name}
                  testId={`signup-nbhd-${n.id}`}
                />
              ))}
            </Stack>
            {shows("nbhd") && (
              <p className="signup-error" data-testid="signup-error-nbhd">
                <ResidentText>{r05("nbhdError")}</ResidentText>
              </p>
            )}
          </fieldset>

          <div className="signup-field">
            <label className="choice-legend" htmlFor="signup-lang">
              <ResidentText>{r05("language")}</ResidentText>
            </label>
            <select id="signup-lang" className="choice-input" value={draft.lang} onChange={(event) => update({ lang: event.target.value as LaunchCode })} data-testid="signup-lang">
              {languages.map((l) => (
                <option key={l.code} value={l.code} lang={l.bcp47} dir={l.dir}>
                  {l.native}
                </option>
              ))}
            </select>
            {choices?.lang === draft.lang && (
              <ResidentText as="p" className="choice-hint">
                {r05("languageFrom")}
              </ResidentText>
            )}
          </div>

          <fieldset className="choice-fieldset signup-field" data-testid="signup-places">
            <legend className="choice-legend">
              <ResidentText>{r34("building")}</ResidentText> <span className="signup-tag">{r05("optional")}</span>
            </legend>
            <Stack gap="target">
              <ResidentText as="p" className="choice-hint">
                {r35("floorLine")}
              </ResidentText>
              {state.status === "loading" && draft.buildings.length > 0 && (
                <p role="status" className="choice-hint">
                  <ResidentText>{r35("loading")}</ResidentText>
                </p>
              )}
              {state.status === "failed" && (
                <Stack gap="target">
                  <p role="alert" className="choice-note" data-testid="signup-list-failed">
                    <ResidentText>{r34("listFailed")}</ResidentText>
                  </p>
                  <ChoiceButton variant="secondary" onClick={retry} testId="signup-list-retry">
                    {r35("retry")}
                  </ChoiceButton>
                </Stack>
              )}
              <Stack gap="target" as="ul">
                {draft.buildings.map((rsn) => {
                  const listed = list?.buildings.find((b) => b.rsn === rsn);
                  const floorIds = listed?.floors.map((f) => f.id) ?? [];
                  return (
                    <li key={rsn} data-rsn={rsn}>
                      <Stack gap="target">
                        <ChoiceOption
                          kind="checkbox"
                          name="buildings"
                          value={rsn}
                          checked
                          onChange={() => toggleBuilding(rsn, floorIds)}
                          label={listed?.address ?? r34("buildingByRsn", { rsn })}
                          line={listed?.neighbourhood}
                          isolate={listed !== undefined}
                          testId={`signup-building-${rsn}`}
                        />
                        {listed && listed.floors.length > 0 && (
                          <fieldset className="choice-fieldset choice-floors" data-testid={`signup-floors-${rsn}`}>
                            <legend className="choice-legend">{withIsolated((address) => r35("floorsIn", { building: address }), listed.address)}</legend>
                            <Stack gap="target" as="ul">
                              {listed.floors.map((floor) => (
                                <li key={floor.id}>
                                  <ChoiceOption
                                    kind="checkbox"
                                    name="floors"
                                    value={floor.id}
                                    checked={draft.floors.includes(floor.id)}
                                    onChange={() => toggleFloor(floor.id)}
                                    label={withIsolated((n) => r35("floorN", { n }), floor.label)}
                                    testId={`signup-floor-${floor.id}`}
                                  />
                                </li>
                              ))}
                            </Stack>
                          </fieldset>
                        )}
                      </Stack>
                    </li>
                  );
                })}
              </Stack>
              {list && (
                <>
                  <input
                    className="choice-input"
                    type="search"
                    dir="auto"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={r35("buildingSearch")}
                    aria-label={r35("buildingSearch")}
                    data-testid="signup-building-search"
                  />
                  {shown.length === 0 && query.trim() !== "" && (
                    <p className="choice-hint" data-testid="signup-no-match">
                      {withIsolated((q) => r35("noMatch", { q }), query.trim(), "auto")}
                    </p>
                  )}
                  {shown.length > 0 && (
                    <Stack gap="target" as="ul" testId="signup-building-options">
                      {shown.map((b) => (
                        <li key={b.rsn}>
                          <ChoiceOption
                            kind="checkbox"
                            name="add-building"
                            value={b.rsn}
                            checked={false}
                            onChange={() => toggleBuilding(b.rsn, [])}
                            label={b.address}
                            line={b.neighbourhood}
                            isolate
                            testId={`signup-add-${b.rsn}`}
                          />
                        </li>
                      ))}
                    </Stack>
                  )}
                </>
              )}
            </Stack>
          </fieldset>

          <fieldset className="choice-fieldset signup-field" data-testid="signup-groups">
            <legend className="choice-legend">
              <ResidentText>{r05("groupsTitle")}</ResidentText> <span className="signup-tag">{r05("optional")}</span>
            </legend>
            <Stack gap="target">
              <ResidentText as="p" className="choice-hint">
                {r05("groupsLead")}
              </ResidentText>
              {SIGNUP_GROUPS.map((group) => (
                <ChoiceOption
                  key={group}
                  kind="checkbox"
                  name="groups"
                  value={group}
                  checked={draft.groups.includes(group)}
                  onChange={() => toggleGroup(group)}
                  label={groupText(`${group}.label`)}
                  line={groupText(`${group}.line`)}
                  testId={`signup-group-${group}`}
                />
              ))}
            </Stack>
          </fieldset>

          <div className="signup-field" data-testid="signup-terms">
            <Stack gap="target">
              {termsDraft && (
                <p className="signup-draft" role="note" data-testid="signup-terms-draft">
                  <ResidentText>{terms("draftTitle")}</ResidentText>
                </p>
              )}
              <p className="choice-hint">
                <Link className="signup-link" href={`/${lang}/terms`} target="_blank" rel="noopener" data-testid="signup-terms-link">
                  <ResidentText>{t("termsLink")}</ResidentText>
                </Link>{" "}
                <span data-testid="signup-terms-version">{withIsolated((version) => t("termsVersion", { version }), consentVersion)}</span>
              </p>
              <ChoiceOption kind="checkbox" name="terms" value="agreed" checked={termsAgreed} onChange={() => setTermsAgreed(!termsAgreed)} label={t("termsAgree")} testId="signup-terms-agree" />
              {shows("terms") && (
                <p className="signup-error" data-testid="signup-error-terms">
                  <ResidentText>{t("error.terms_not_agreed")}</ResidentText>
                </p>
              )}
              <ChoiceOption kind="checkbox" name="age" value="confirmed" checked={ageConfirmed} onChange={() => setAgeConfirmed(!ageConfirmed)} label={t("age")} testId="signup-age" />
              {shows("age") && (
                <p className="signup-error" data-testid="signup-error-age">
                  <ResidentText>{t("error.age_not_confirmed")}</ResidentText>
                </p>
              )}
            </Stack>
          </div>

          <Stack gap="label">
            <ResidentText as="p" className="choice-hint">
              {r05("consent")}
            </ResidentText>
            <ResidentText as="p" className="choice-hint">
              {r05("whatYouGet")}
            </ResidentText>
          </Stack>

          <button type="submit" className="choice-btn choice-btn--primary tap signup-send" disabled={status === "sending"} data-testid="signup-send">
            <ResidentText>{status === "sending" ? t("sending") : r05("send")}</ResidentText>
          </button>
          <p className="choice-hint">
            <ResidentText>{r05("noAccount")}</ResidentText>
          </p>
        </Stack>
      </form>
    </Screen>
  );
}
