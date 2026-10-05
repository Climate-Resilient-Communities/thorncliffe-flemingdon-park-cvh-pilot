import Link from "next/link";
import type { LaunchCode } from "@/i18n/languages";
import { Not911 } from "../emergency";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { ResidentText } from "../text/resident-text";
import type { AlertView, Translate } from "./alert-view";
import { DisruptionTypes, OriginMark } from "./alert-parts";
import "../shell/icons.css";

/**
 * "What verified means" (R-28, S04.08): the alert it was opened from (its types and who sent it, with the line that says when the Hub
 * checked it, or that it has not), what the words mean, and the words you will see on alerts, each with its icon and shape. In the pilot there
 * are two: "Verified by the Hub" and "Not yet verified" (an official government alert, A10, is a stretch goal and has no row yet). The 911
 * statement is the short form here, as in the prototype, and the way back is the alert.
 */
export function VerifiedExplainer({ view, lang, t }: { view: AlertView; lang: LaunchCode; t: Translate }) {
  const x01 = (key: "text" | "call" | "short") => t(`x01.${key}`);
  const back = `/${lang}/alerts/${view.slug}`;
  const verified = view.origin.verified;
  const legend = [
    { id: "verified", icon: "verified", word: t("x02.verifiedBy", { org: t("x02.hub") }), line: t("R28.legendVerified"), current: verified },
    { id: "unverified", icon: "unverified", word: t("x02.notYetVerified"), line: t("R28.legendUnverified"), current: !verified },
  ] as const;
  return (
    <Screen surface="resident" testId="verified-explainer">
      <Stack gap="section-resident">
        <Link className="alert-back tap" href={back} prefetch={false} data-testid="verified-back">
          <span className="shell-ico shell-ico--back shell-ico--mirror shell-ico--sm" aria-hidden="true" />
          <ResidentText>{t("shell.back")}</ResidentText>
        </Link>
        <ResidentText as="h1">{t("R28.title")}</ResidentText>

        <section className="alert-this" aria-labelledby="alert-this-title" data-testid="verified-this">
          <ResidentText as="p" className="alert-eyebrow" testId="alert-this-title">
            {t("R28.thisAlert")}
          </ResidentText>
          <DisruptionTypes types={view.types} />
          <OriginMark origin={view.origin} />
          {verified ? (
            <ResidentText as="p" className="alert-strong" testId="verified-line">
              {t("R28.who", { org: t("x02.theHub"), t: view.current.time })}
            </ResidentText>
          ) : (
            <Stack gap="label">
              <ResidentText as="p">{t("R28.notYet")}</ResidentText>
              <ResidentText as="p" className="alert-strong">
                {t("R28.notFalse")}
              </ResidentText>
              <ResidentText as="p">{t("R28.notYetAct")}</ResidentText>
            </Stack>
          )}
        </section>

        <ResidentText as="p" testId="verified-body">
          {t("R28.body")}
        </ResidentText>

        <section className="alert-section hide-basic" aria-labelledby="alert-legend-title" data-testid="verified-legend">
          <ResidentText as="h2" testId="alert-legend-title">
            {t("R28.legendTitle")}
          </ResidentText>
          <ul className="alert-legend">
            {legend.map((row) => (
              <li className="alert-legend__item" key={row.id} data-testid={`legend-${row.id}`} data-current={row.current}>
                <span className={`alert-verify alert-verify--${row.id}`}>
                  <span className={`alert-ico alert-ico--${row.icon}`} aria-hidden="true" />
                </span>
                <span className="alert-legend__body">
                  <span className="alert-strong">
                    <ResidentText>{row.word}</ResidentText>
                    {row.current && (
                      <>
                        {" "}
                        <span className="alert-tag">
                          <ResidentText>{t("R28.thisOne")}</ResidentText>
                        </span>
                      </>
                    )}
                  </span>
                  <ResidentText as="span" className="alert-caption">
                    {row.line}
                  </ResidentText>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <Not911 variant="inline" t={x01} />

        <Link className="alert-button tap" href={back} prefetch={false} data-testid="verified-back-button">
          <span className="shell-ico shell-ico--back shell-ico--mirror shell-ico--sm" aria-hidden="true" />
          <ResidentText>{t("R28.backToAlert")}</ResidentText>
        </Link>
      </Stack>
    </Screen>
  );
}
