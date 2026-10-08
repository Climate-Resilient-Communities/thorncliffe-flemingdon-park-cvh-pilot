"use client";
import { orderedLanguages } from "../shell/language-order";


import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { CheckinAnswer } from "@/contracts/checkin";
import { SIGNUP_GROUPS } from "@/contracts/signup";
import {
  EDIT_TOKEN,
  EditDoneBodySchema,
  EditExpiredBodySchema,
  EditViewBodySchema,
  MUTABLE_TOPICS,
  SUBSCRIPTION_CHANGE_PATH,
  SUBSCRIPTION_DELETE_PATH,
  SUBSCRIPTION_EDIT_CONTRACT_VERSION,
  SUBSCRIPTION_EDIT_ERROR_CODES,
  SUBSCRIPTION_VIEW_PATH,
  type EditChangeRequestBody,
  type SubscriptionEditErrorCode,
  type SubscriptionView,
} from "@/contracts/subscriptionEdit";
import type { LaunchCode } from "@/i18n/languages";
import { CheckinAnswerNote, CheckinFields, NO_REQUEST, draftOf, problemOf, requestBody, whereOptions, type CheckinDraft, type HeldRequest } from "../checkin";
import { sortBuildings } from "../choices/building-list";
import { ChoiceButton, ChoiceOption } from "../choices/parts";
import type { StepLanguage } from "../choices/language-step";
import { useBuildingList } from "../choices/use-choices";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { withIsolated } from "../text/isolated";
import { ResidentText } from "../text/resident-text";
import "../choices/choices.css";
import "../signup/signup.css";
import "./subscription.css";

export interface SubscriptionNeighbourhood {
  id: string;
  name: string;
}

export interface SubscriptionEditProps {
  lang: LaunchCode;
  languages: readonly StepLanguage[];
  neighbourhoods: readonly SubscriptionNeighbourhood[];
  /** The Hub's number as a resident dials it, for the expired link's page. */
  hub: string;
  /** Test seam: where the three requests go. */
  endpoints?: { view: string; change: string; delete: string };
}

const ENDPOINTS = { view: SUBSCRIPTION_VIEW_PATH, change: SUBSCRIPTION_CHANGE_PATH, delete: SUBSCRIPTION_DELETE_PATH };

interface Draft {
  lang: LaunchCode;
  nbhd: string;
  places: { rsn: string; floors: string[] }[];
  groups: string[];
  muted: string[];
}

type Phase =
  | { kind: "loading" }
  | { kind: "expired" }
  | { kind: "unreachable" }
  | { kind: "form"; view: SubscriptionView }
  | { kind: "saved"; checkin: CheckinAnswer | null }
  | { kind: "deleted" };

type Problem = SubscriptionEditErrorCode | "network";

const isErrorCode = (value: unknown): value is SubscriptionEditErrorCode => typeof value === "string" && (SUBSCRIPTION_EDIT_ERROR_CODES as readonly string[]).includes(value);
const textMatches = (text: string, query: string) => text.toLowerCase().includes(query.trim().toLowerCase());

/** One POST of the page: JSON, no cookie, no referrer, never from a cache. */
function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
}

/**
 * The one-time web link's page (S07.06): change the language, places (any number of buildings, each with floors or none), groups, muted topics
 * and the neighbourhood, or delete the subscription. The token is read from the address in the browser and sent only in POST bodies; the page
 * the server sends is the same for every link and holds nothing about anyone, so a link preview sees nothing and uses nothing. The choices
 * come from `/api/subscription/view`. Saving or deleting uses the link: the page then says what happened, and a link that was used or ran out
 * says "This link has expired" and how to get a new one by text. Nothing is kept on the phone, no cookie is set, and the number shows only by
 * its last two digits.
 */
export function SubscriptionEdit({ lang, languages, neighbourhoods, hub, endpoints = ENDPOINTS }: SubscriptionEditProps) {
  const t = useTranslations("subscriptionEdit");
  const r05 = useTranslations("R05");
  const r34 = useTranslations("R34");
  const r35 = useTranslations("R35");
  const groupText = useTranslations("groups");
  const topicText = useTranslations("x13");
  const params = useParams<{ token?: string }>();
  const token = typeof params?.token === "string" ? params.token : "";

  const [loaded, setPhase] = useState<Phase>({ kind: "loading" });
  // A token that cannot be one is not sent anywhere: the page says the link has expired.
  const tokenShaped = EDIT_TOKEN.test(token);
  const phase: Phase = tokenShaped ? loaded : { kind: "expired" };
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [attempt, setAttempt] = useState(0);
  // S08.05: the check-in request as the page found it, and as the resident leaves it (held in the page's memory only).
  const [held, setHeld] = useState<HeldRequest | null>(null);
  const [checkin, setCheckin] = useState<CheckinDraft>(NO_REQUEST);
  const [sent, setSent] = useState(false);
  const checkinRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  // Each refusal moves the focus to the error box, once the render that shows the box is on the page: an update made after an await is
  // rendered in a later task, so a requestAnimationFrame callback could run first and find no box to focus.
  const [errorShown, setErrorShown] = useState(0);
  const { state, retry } = useBuildingList(phase.kind === "form");
  const list = state.status === "ready" ? state.list : null;

  useEffect(() => {
    if (!tokenShaped) return;
    let current = true;
    void (async () => {
      try {
        const response = await post(endpoints.view, { v: SUBSCRIPTION_EDIT_CONTRACT_VERSION, token });
        const body: unknown = await response.json().catch(() => null);
        if (!current) return;
        const view = EditViewBodySchema.safeParse(body);
        if (view.success) {
          const shown = view.data.subscription;
          setDraft({ lang: shown.lang, nbhd: shown.neighbourhood, places: shown.places.map((p) => ({ rsn: p.rsn, floors: [...p.floors] })), groups: [...shown.groups], muted: [...shown.muted_topics] });
          const found = shown.checkin === null ? null : { rsn: shown.checkin.rsn, floorId: shown.checkin.floor, method: shown.checkin.method };
          setHeld(found);
          setCheckin(draftOf(found));
          setPhase({ kind: "form", view: shown });
        } else setPhase(EditExpiredBodySchema.safeParse(body).success ? { kind: "expired" } : { kind: "unreachable" });
      } catch {
        if (current) setPhase({ kind: "unreachable" });
      }
    })();
    return () => {
      current = false;
    };
  }, [endpoints.view, token, tokenShaped, attempt]);

  useEffect(() => {
    if (errorShown > 0) errorRef.current?.focus();
  }, [errorShown]);

  useEffect(() => {
    // Every new state of the page starts at its heading, wherever the form was scrolled to.
    if (phase.kind === "loading" || phase.kind === "form") return;
    window.scrollTo(0, 0);
    headingRef.current?.closest("main")?.scrollTo(0, 0);
    headingRef.current?.focus({ preventScroll: true });
  }, [phase.kind]);

  const shown = useMemo(() => {
    if (!list || !draft || query.trim() === "") return [];
    return sortBuildings(list.buildings).filter((b) => !draft.places.some((p) => p.rsn === b.rsn) && (textMatches(b.address, query) || textMatches(b.neighbourhood, query)));
  }, [list, query, draft]);

  const home = (
    <Link className="choice-btn choice-btn--primary tap" href={`/${lang}`} data-testid="subscription-home">
      <ResidentText>{r05("toHome")}</ResidentText>
    </Link>
  );

  if (phase.kind === "loading") {
    return (
      <Screen surface="resident" testId="subscription-edit">
        <Stack gap="label">
          <ResidentText as="h1">{t("title")}</ResidentText>
          <p role="status" className="choice-hint" data-testid="subscription-loading">
            <ResidentText>{t("loading")}</ResidentText>
          </p>
        </Stack>
      </Screen>
    );
  }

  if (phase.kind === "expired" || phase.kind === "unreachable" || phase.kind === "saved" || phase.kind === "deleted") {
    const words = {
      expired: { title: t("expiredTitle"), lines: [t("expiredBody"), t("expiredHow")] },
      unreachable: { title: t("title"), lines: [t("error.network")] },
      saved: { title: t("savedTitle"), lines: [t("savedBody")] },
      deleted: { title: t("deletedTitle"), lines: [t("deletedBody")] },
    }[phase.kind];
    return (
      <Screen surface="resident" testId={`subscription-${phase.kind}`}>
        <Stack gap="stack">
          <section className="signup-sent" role="status" aria-labelledby="subscription-outcome-title" data-testid="subscription-outcome">
            <Stack gap="related">
              <h1 id="subscription-outcome-title" tabIndex={-1} ref={headingRef}>
                <ResidentText>{words.title}</ResidentText>
              </h1>
              {words.lines.map((line, index) => (
                <ResidentText key={line} as="p" className={index === 0 ? "signup-lead" : undefined} testId={`subscription-outcome-${index}`}>
                  {line}
                </ResidentText>
              ))}
              {phase.kind === "saved" && phase.checkin !== null && <CheckinAnswerNote answer={phase.checkin} page="edit" hub={hub} testId="subscription-checkin-answer" />}
              {phase.kind === "expired" && (
                <p data-testid="subscription-call-hub">
                  {withIsolated((number) => t("callHub", { hub: number }), <a href={`tel:${hub.replace(/[^0-9+]/g, "")}`}>{hub}</a>)}
                </p>
              )}
            </Stack>
          </section>
          <div className="choice-actions">
            {phase.kind === "unreachable" && (
              <ChoiceButton
                variant="secondary"
                onClick={() => {
                  setPhase({ kind: "loading" });
                  setAttempt((count) => count + 1);
                }}
                testId="subscription-retry"
              >
                {r35("retry")}
              </ChoiceButton>
            )}
            {phase.kind === "deleted" && (
              <Link className="choice-btn choice-btn--secondary tap" href={`/${lang}/text-alerts`} data-testid="subscription-sign-up">
                <ResidentText>{t("signUpAgain")}</ResidentText>
              </Link>
            )}
            {home}
          </div>
        </Stack>
      </Screen>
    );
  }

  const form = draft!;
  const update = (change: Partial<Draft>) => setDraft({ ...form, ...change });
  const toggle = (values: string[], value: string) => (values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  const removeBuilding = (rsn: string) => update({ places: form.places.filter((p) => p.rsn !== rsn) });
  const addBuilding = (rsn: string) => {
    update({ places: [...form.places, { rsn, floors: [] }] });
    setQuery("");
  };
  const toggleFloor = (rsn: string, id: string) => update({ places: form.places.map((p) => (p.rsn === rsn ? { ...p, floors: toggle(p.floors, id) } : p)) });
  // The "where I live" choices: the buildings and floors the page will save (known once the building list has loaded).
  const options = list ? whereOptions(form.places, list.buildings) : [];
  const checkinProblem = problemOf(checkin, held, options);

  const answered = async (response: Response, done: "changed" | "deleted") => {
    const body: unknown = await response.json().catch(() => null);
    const outcome = EditDoneBodySchema.safeParse(body);
    if (outcome.success && outcome.data.status === done) {
      setPhase(done === "changed" ? { kind: "saved", checkin: outcome.data.checkin ?? null } : { kind: "deleted" });
      return;
    }
    if (EditExpiredBodySchema.safeParse(body).success) {
      setPhase({ kind: "expired" });
      return;
    }
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    setProblem(isErrorCode(code) ? code : "edit_unavailable");
    setErrorShown((count) => count + 1);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    setSent(true);
    if (checkinProblem !== null) {
      requestAnimationFrame(() => checkinRef.current?.querySelector<HTMLElement>("input")?.focus());
      return;
    }
    const checkinBody = list ? requestBody(checkin, held, options, "edit") : undefined;
    const request: EditChangeRequestBody = {
      v: SUBSCRIPTION_EDIT_CONTRACT_VERSION,
      token,
      lang: form.lang,
      neighbourhood: form.nbhd,
      places: form.places,
      groups: SIGNUP_GROUPS.filter((g) => form.groups.includes(g)),
      muted_topics: MUTABLE_TOPICS.filter((topic) => form.muted.includes(topic)),
      // S08.05: the request as the page leaves it, or null to withdraw the one held. With the building list unread there are no choices, and
      // with none held and none asked there is nothing to say, so the field is left out (the request, if any, is kept as it is).
      ...(checkinBody !== undefined ? { checkin: checkinBody } : {}),
    };
    setBusy("save");
    try {
      await answered(await post(endpoints.change, request), "changed");
    } catch {
      setProblem("network");
      setErrorShown((count) => count + 1);
    }
    setBusy(null);
  };

  const remove = async () => {
    setProblem(null);
    setBusy("delete");
    try {
      await answered(await post(endpoints.delete, { v: SUBSCRIPTION_EDIT_CONTRACT_VERSION, token }), "deleted");
    } catch {
      setProblem("network");
      setErrorShown((count) => count + 1);
    }
    setBusy(null);
  };

  return (
    <Screen surface="resident" testId="subscription-edit">
      <form onSubmit={save} noValidate data-testid="subscription-form">
        <Stack gap="stack">
          <Stack gap="label">
            <ResidentText as="h1">{t("title")}</ResidentText>
            <p className="signup-lead" data-testid="subscription-number">
              {withIsolated((digits) => t("forNumber", { digits }), phase.view.phone_last2)}
            </p>
            <ResidentText as="p">{t("lead")}</ResidentText>
          </Stack>

          {problem !== null && (
            <div className="signup-errorbox" role="alert" tabIndex={-1} ref={errorRef} data-testid="subscription-errorbox">
              <ResidentText as="p">{t(`error.${problem}`)}</ResidentText>
            </div>
          )}

          <div className="signup-field">
            <label className="choice-legend" htmlFor="subscription-lang">
              <ResidentText>{r05("language")}</ResidentText>
            </label>
            <select id="subscription-lang" className="choice-input" value={form.lang} onChange={(event) => update({ lang: event.target.value as LaunchCode })} data-testid="subscription-lang">
              {orderedLanguages(languages).map((l) => (
                <option key={l.code} value={l.code} lang={l.bcp47} dir={l.dir}>
                  {l.native}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="choice-fieldset signup-field" data-testid="subscription-nbhd">
            <legend className="choice-legend">
              <ResidentText>{r05("nbhd")}</ResidentText> <span className="signup-tag">{r05("required")}</span>
            </legend>
            <Stack gap="target">
              {neighbourhoods.map((n) => (
                <ChoiceOption key={n.id} kind="radio" name="nbhd" value={n.id} checked={form.nbhd === n.id} onChange={() => update({ nbhd: n.id })} label={n.name} testId={`subscription-nbhd-${n.id}`} />
              ))}
            </Stack>
          </fieldset>

          <fieldset className="choice-fieldset signup-field" data-testid="subscription-places">
            <legend className="choice-legend">
              <ResidentText>{r34("building")}</ResidentText> <span className="signup-tag">{r05("optional")}</span>
            </legend>
            <Stack gap="target">
              <ResidentText as="p" className="choice-hint">
                {r35("floorLine")}
              </ResidentText>
              {state.status === "loading" && (
                <p role="status" className="choice-hint">
                  <ResidentText>{r35("loading")}</ResidentText>
                </p>
              )}
              {state.status === "failed" && (
                <Stack gap="target">
                  <p role="alert" className="choice-note" data-testid="subscription-list-failed">
                    <ResidentText>{r34("listFailed")}</ResidentText>
                  </p>
                  <ChoiceButton variant="secondary" onClick={retry} testId="subscription-list-retry">
                    {r35("retry")}
                  </ChoiceButton>
                </Stack>
              )}
              <Stack gap="target" as="ul">
                {form.places.map((place) => {
                  const listed = list?.buildings.find((b) => b.rsn === place.rsn);
                  return (
                    <li key={place.rsn} data-rsn={place.rsn}>
                      <Stack gap="target">
                        <ChoiceOption
                          kind="checkbox"
                          name="buildings"
                          value={place.rsn}
                          checked
                          onChange={() => removeBuilding(place.rsn)}
                          label={listed?.address ?? r34("buildingByRsn", { rsn: place.rsn })}
                          line={listed?.neighbourhood}
                          isolate={listed !== undefined}
                          testId={`subscription-building-${place.rsn}`}
                        />
                        {listed && listed.floors.length > 0 && (
                          <fieldset className="choice-fieldset choice-floors" data-testid={`subscription-floors-${place.rsn}`}>
                            <legend className="choice-legend">{withIsolated((address) => r35("floorsIn", { building: address }), listed.address)}</legend>
                            <Stack gap="target" as="ul">
                              {listed.floors.map((floor) => (
                                <li key={floor.id}>
                                  <ChoiceOption
                                    kind="checkbox"
                                    name={`floors-${place.rsn}`}
                                    value={floor.id}
                                    checked={place.floors.includes(floor.id)}
                                    onChange={() => toggleFloor(place.rsn, floor.id)}
                                    label={withIsolated((n) => r35("floorN", { n }), floor.label)}
                                    testId={`subscription-floor-${floor.id}`}
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
                    data-testid="subscription-building-search"
                  />
                  {shown.length === 0 && query.trim() !== "" && (
                    <p className="choice-hint" data-testid="subscription-no-match">
                      {withIsolated((q) => r35("noMatch", { q }), query.trim(), "auto")}
                    </p>
                  )}
                  {shown.length > 0 && (
                    <Stack gap="target" as="ul" testId="subscription-building-options">
                      {shown.map((b) => (
                        <li key={b.rsn}>
                          <ChoiceOption kind="checkbox" name="add-building" value={b.rsn} checked={false} onChange={() => addBuilding(b.rsn)} label={b.address} line={b.neighbourhood} isolate testId={`subscription-add-${b.rsn}`} />
                        </li>
                      ))}
                    </Stack>
                  )}
                </>
              )}
            </Stack>
          </fieldset>

          <fieldset className="choice-fieldset signup-field" data-testid="subscription-groups">
            <legend className="choice-legend">
              <ResidentText>{r05("groupsTitle")}</ResidentText> <span className="signup-tag">{r05("optional")}</span>
            </legend>
            <Stack gap="target">
              {SIGNUP_GROUPS.map((group) => (
                <ChoiceOption
                  key={group}
                  kind="checkbox"
                  name="groups"
                  value={group}
                  checked={form.groups.includes(group)}
                  onChange={() => update({ groups: toggle(form.groups, group) })}
                  label={groupText(`${group}.label`)}
                  line={groupText(`${group}.line`)}
                  testId={`subscription-group-${group}`}
                />
              ))}
            </Stack>
          </fieldset>

          <fieldset className="choice-fieldset signup-field" data-testid="subscription-topics">
            <legend className="choice-legend">
              <ResidentText>{t("topicsTitle")}</ResidentText> <span className="signup-tag">{r05("optional")}</span>
            </legend>
            <Stack gap="target">
              <ResidentText as="p" className="choice-hint">
                {t("topicsLead")}
              </ResidentText>
              {MUTABLE_TOPICS.map((topic) => (
                <ChoiceOption
                  key={topic}
                  kind="checkbox"
                  name="muted"
                  value={topic}
                  checked={form.muted.includes(topic)}
                  onChange={() => update({ muted: toggle(form.muted, topic) })}
                  label={topicText(topic)}
                  testId={`subscription-topic-${topic}`}
                />
              ))}
            </Stack>
          </fieldset>

          <div ref={checkinRef}>
            <CheckinFields lang={lang} draft={checkin} onChange={setCheckin} options={options} held={held} showProblems={sent} prefix="subscription" />
          </div>

          <button type="submit" className="choice-btn choice-btn--primary tap signup-send" disabled={busy !== null} data-testid="subscription-save">
            <ResidentText>{busy === "save" ? t("saving") : t("save")}</ResidentText>
          </button>

          <section className="subscription-delete" aria-labelledby="subscription-delete-title" data-testid="subscription-delete">
            <Stack gap="related">
              <h2 id="subscription-delete-title">
                <ResidentText>{t("deleteTitle")}</ResidentText>
              </h2>
              <ResidentText as="p">{t("deleteLead")}</ResidentText>
              {askDelete ? (
                <Stack gap="target">
                  <ResidentText as="p" className="signup-lead" testId="subscription-delete-sure">
                    {t("deleteSure")}
                  </ResidentText>
                  <div className="choice-actions">
                    <ChoiceButton variant="secondary" onClick={() => setAskDelete(false)} testId="subscription-delete-no">
                      {t("deleteNo")}
                    </ChoiceButton>
                    <button type="button" className="choice-btn choice-btn--danger tap" disabled={busy !== null} onClick={() => void remove()} data-testid="subscription-delete-yes">
                      <ResidentText>{busy === "delete" ? t("deleting") : t("deleteYes")}</ResidentText>
                    </button>
                  </div>
                </Stack>
              ) : (
                <ChoiceButton variant="danger" onClick={() => setAskDelete(true)} testId="subscription-delete-ask">
                  {t("deleteTitle")}
                </ChoiceButton>
              )}
            </Stack>
          </section>
        </Stack>
      </form>
    </Screen>
  );
}
