"use client";

// What the Hub decided about a suggestion, read by its reference code (PRD §6.3; R-23 for a declined one): waiting, accepted (on the map with
// the Hub's next update of the places), or not added yet with the pre-written reason and what to change, in the page's language. A declined
// new place can be changed and sent again: its words go back to R-19 on this phone (session storage) and nowhere else.
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PlaceSubmissionStatusSchema, type PlaceSubmissionErrorCode, type PlaceSubmissionStatus } from "@/contracts/placeSubmission";
import { languageOf, type LaunchCode } from "@/i18n/languages";
import { useBuildingList } from "../choices/use-choices";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { ResidentText } from "../text/resident-text";
import { SUBMISSIONS_URL, writeResubmit } from "./form-model";
import { Back, StepHeading } from "./parts";
import "../choices/choices.css";
import "../signup/signup.css";
import "./places.css";

// `now`: when the answer was read, the moment "sent 2 days ago" is counted from (a render reads no clock).
type State = { kind: "loading" } | { kind: "ready"; status: PlaceSubmissionStatus; now: number } | { kind: "refused"; code: PlaceSubmissionErrorCode };

async function readStatus(code: string): Promise<State> {
  try {
    const response = await fetch(`${SUBMISSIONS_URL}/${encodeURIComponent(code)}`, { cache: "no-store" });
    const json: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const parsed = PlaceSubmissionStatusSchema.safeParse(json);
      if (parsed.success) return { kind: "ready", status: parsed.data, now: Date.now() };
    }
    if (response.status === 404) return { kind: "refused", code: "not_found" };
    if (response.status === 429) return { kind: "refused", code: "rate_limited" };
    return { kind: "refused", code: "submissions_unavailable" };
  } catch {
    return { kind: "refused", code: "submissions_unavailable" };
  }
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** "2 days ago", in the page's language, from the language's own rules (Intl): no sentence of the catalog needed for it. */
function ago(iso: string, now: number, locale: string): string {
  const days = Math.round((Date.parse(iso) - now) / 86_400_000);
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day");
}

export function SubmissionStatusPage({ lang, code }: { lang: LaunchCode; code: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const { state: buildings } = useBuildingList();
  const locale = languageOf(lang).bcp47;

  useEffect(() => {
    let live = true;
    void readStatus(code).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [code]);

  const map = `/${lang}/map`;
  if (state.kind !== "ready") {
    return (
      <Screen surface="resident" testId="places-status">
        <Stack gap="section-resident">
          <Back href={map} />
          {state.kind === "loading" ? (
            <p role="status" aria-busy="true" data-testid="places-status-loading">
              <span className="places-ref" dir="ltr" lang="en">
                {code}
              </span>
            </p>
          ) : (
            <Stack gap="related">
              <StepHeading testId="places-status-refused">{state.code === "not_found" ? t("places.notFoundTitle") : t("R21.title")}</StepHeading>
              <p className="places-ref" dir="ltr" lang="en">
                {code}
              </p>
              <ResidentText as="p" className={state.code === "not_found" ? undefined : "signup-error"}>
                {t(`places.errors.${state.code}`)}
              </ResidentText>
            </Stack>
          )}
        </Stack>
      </Screen>
    );
  }

  const { status } = state;
  const whereText = (() => {
    if (status.where_text) return status.where_text;
    const where = status.where;
    if (!where) return null;
    if (where.kind === "address") return where.text;
    if (where.kind === "pin") return t("places.pin");
    const address = buildings.status === "ready" ? buildings.list.buildings.find((b) => b.rsn === where.rsn)?.address : undefined;
    return [address ?? where.rsn, where.text].filter(Boolean).join(". ");
  })();
  const wrote = [
    { label: t("R19.name"), value: status.name, strong: true },
    ...(status.what ? [{ label: t("R19.what"), value: status.what, strong: false }] : []),
    { label: status.kind === "correct" ? t("R22.whereLabel") : t("R19.location"), value: whereText ?? t("R23.whereNone"), strong: whereText === null },
  ];
  const title = status.status === "declined" ? t("R23.title") : status.status === "accepted" ? t("places.acceptedTitle") : t("places.pendingTitle");
  const resubmit = () => {
    if (!status.reason || status.kind !== "add") return;
    // R-19's type is not part of what the code reads back, so the resident chooses it again; everything they wrote comes back.
    writeResubmit(sessionStore(), { reason: status.reason, draft: { type: "", name: status.name, what: status.what ?? "", where: status.where } });
    router.push(`/${lang}/places/add`);
  };

  return (
    <Screen surface="resident" testId="places-status">
      <Stack gap="section-resident">
        <Back href={map} />
        <Stack gap="related">
          <StepHeading testId="places-status-title">{title}</StepHeading>
          {status.kind === "correct" && <ResidentText as="p">{t("places.correctionOf", { name: status.name })}</ResidentText>}
          <ResidentText as="p" className="choice-hint">
            {t("R23.sentAgo", { t: ago(status.sent_at, state.now, locale) })}
          </ResidentText>
          <p className="choice-hint" dir="ltr" lang="en">
            {code}
          </p>
        </Stack>

        {status.status === "pending" && <ResidentText as="p">{t("places.pendingLine")}</ResidentText>}
        {status.status === "accepted" && <ResidentText as="p">{t("places.acceptedLine")}</ResidentText>}
        {status.status === "declined" && status.reason && (
          <>
            <section className="places-card places-card--key" aria-label={t("R23.reason")} data-testid="places-status-reason">
              <Stack gap="related">
                <div>
                  <ResidentText as="p" className="places-label">
                    {t("R23.reason")}
                  </ResidentText>
                  <ResidentText as="p">{t(`R23.reasons.${status.reason}.why`)}</ResidentText>
                </div>
                <div>
                  <ResidentText as="p" className="places-label">
                    {t("R23.whatToChange")}
                  </ResidentText>
                  <ResidentText as="p" className="signup-lead">
                    {t(`R23.reasons.${status.reason}.change`)}
                  </ResidentText>
                </div>
              </Stack>
            </section>
            {status.reason === "advert" && (
              <ResidentText as="p" className="places-market">
                {t("x03.market")}
              </ResidentText>
            )}
          </>
        )}

        <section aria-labelledby="places-wrote-title">
          <Stack gap="related">
            <h2 id="places-wrote-title">
              <ResidentText>{t("R23.youWrote")}</ResidentText>
            </h2>
            <dl className="places-card">
              {wrote.map((row) => (
                <div key={row.label} className="places-row__value">
                  <dt className="places-label">
                    <ResidentText>{row.label}</ResidentText>
                  </dt>
                  <dd>{row.strong ? <strong><bdi>{row.value}</bdi></strong> : <bdi>{row.value}</bdi>}</dd>
                </div>
              ))}
            </dl>
            {status.status === "declined" && <ResidentText as="p">{t("R23.kept")}</ResidentText>}
          </Stack>
        </section>

        <div className="choice-actions">
          {status.status === "declined" && status.kind === "add" && (
            <button type="button" className="choice-btn choice-btn--primary tap" onClick={resubmit} data-testid="places-resubmit">
              <ResidentText>{t("R23.resubmit")}</ResidentText>
            </button>
          )}
          <Link className="choice-btn choice-btn--secondary tap" href={map} prefetch={false} data-testid="places-to-map">
            <ResidentText>{t("R23.toMap")}</ResidentText>
          </Link>
        </div>
      </Stack>
    </Screen>
  );
}
