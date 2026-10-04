"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import type { ArchiveV1 } from "@/contracts/feed";
import type { LaunchCode } from "@/i18n/languages";
import { DisruptionTypes, OriginMark, AlertText } from "../alert/alert-parts";
import type { Translate } from "../alert/alert-view";
import { Not911 } from "../emergency";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { ResidentText } from "../text/resident-text";
import { archiveCards, joinPages } from "./archive-view";
import { fetchArchivePage } from "./fetch-archive";
import "../alert/alert-icons.css";
import "../choices/choices.css";
import "../shell/icons.css";
import "./archive.css";

/**
 * Archived alerts (R-08, S05.07): the alerts that have ended, newest ended first, each as it was when live (its types, its words, who sent it and whether the Hub checked
 * it) with how and when it ended and when it was posted; each card is the link to the alert (R-07), which opens read-only with the final entry on top. The first page comes
 * with the page, so a copy of it kept for reading without signal has the alerts in it; "Show older alerts" asks for the next. Nothing about the resident is sent.
 */
export function ArchiveScreen({ lang, initial }: { lang: LaunchCode; initial: ArchiveV1 }) {
  const t = useTranslations("R08");
  const x01 = useTranslations("x01");
  const all = useTranslations() as unknown as Translate;
  const [pages, setPages] = useState<ArchiveV1[]>([initial]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const last = pages[pages.length - 1];
  const cards = joinPages(pages.map((page) => archiveCards(page.threads, { lang, serverNow: new Date(page.server_now), t: all })));

  const more = async () => {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    const next = await fetchArchivePage(lang, last.page + 1);
    setLoading(false);
    if (next === null) setFailed(true);
    else setPages((current) => [...current, next]);
  };

  return (
    <Screen surface="resident" testId="archive">
      <Stack gap="section-resident">
        <Link className="alert-back tap" href={`/${lang}`} prefetch={false} data-testid="archive-back">
          <span className="shell-ico shell-ico--back shell-ico--mirror shell-ico--sm" aria-hidden="true" />
          <ResidentText>{all("shell.back")}</ResidentText>
        </Link>
        <Stack gap="subline">
          <ResidentText as="h1" testId="archive-title">
            {t("title")}
          </ResidentText>
          <ResidentText as="p">{t("lead")}</ResidentText>
        </Stack>

        {cards.length === 0 ? (
          <Stack gap="related">
            <div className="alert-note" data-testid="archive-empty">
              <div className="alert-note__body">
                <ResidentText as="p" className="alert-note__title">
                  {t("empty")}
                </ResidentText>
                <ResidentText as="p">{t("emptyBody")}</ResidentText>
              </div>
            </div>
            <Link className="choice-btn choice-btn--secondary tap archive-more" href={`/${lang}`} prefetch={false} data-testid="archive-home">
              <ResidentText>{t("backHome")}</ResidentText>
            </Link>
          </Stack>
        ) : (
          <ul className="alert-card-list" aria-label={t("title")} data-testid="archive-list">
            {cards.map((card) => (
              <li className="alert-card-item" key={card.slug}>
                {/* prefetch off, as every link to an alert: Next would otherwise fetch each alert's page as soon as its link is on screen. */}
                <Link className="alert-card alert-card--ended tap" href={`/${lang}/alerts/${card.slug}`} prefetch={false} data-testid={`archive-card-${card.slug}`} data-reason={card.reason}>
                  <DisruptionTypes types={card.view.types} />
                  <p className="archive-end" data-testid={`archive-end-${card.slug}`}>
                    <span className={`alert-ico alert-ico--${card.icon}`} aria-hidden="true" />
                    <ResidentText>{card.endLine}</ResidentText>
                  </p>
                  <AlertText text={card.view.current.text} testId={`archive-text-${card.slug}`} />
                  <OriginMark origin={card.view.origin} />
                  <ResidentText as="p" className="alert-caption" testId={`archive-posted-${card.slug}`}>
                    {card.posted}
                  </ResidentText>
                  <span className="alert-card__open">
                    <ResidentText>{all("R03.readAlert")}</ResidentText>
                    <span className="shell-ico shell-ico--chevron shell-ico--mirror shell-ico--sm" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {last.has_more && (
          <Stack gap="related">
            <button type="button" className="choice-btn choice-btn--secondary tap archive-more" onClick={more} disabled={loading} data-testid="archive-more">
              <ResidentText>{t("more")}</ResidentText>
            </button>
            {failed && (
              <div className="alert-note" role="status" data-testid="archive-more-failed">
                <ResidentText as="p">{t("moreFailed")}</ResidentText>
              </div>
            )}
          </Stack>
        )}

        <Not911 variant="inline" t={x01} />
      </Stack>
    </Screen>
  );
}
