"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import type { FeedThread } from "@/contracts/feed";
import { languageOf, type LaunchCode } from "@/i18n/languages";
import { useBuildingList, useChoices } from "../choices/use-choices";
import { useGateBuildingList } from "../choices/building-list-context";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { Isolated } from "../text/isolated";
import { ResidentText } from "../text/resident-text";
import { agoText } from "./feed-poll";
import { homeRows, type BuildingRow, type NeighbourhoodRow, type Shown } from "./home-view";
import { useFeed } from "./use-feed";
import "../choices/choices.css";
import "./home.css";

type Translator = ReturnType<typeof useTranslations>;

// How each thing a place can show looks: the catalog key of its words, and its icon. Every one has both, so a status is
// never colour alone.
const LOOK = {
  checking: { key: "checking", icon: "statusUnknown" },
  unknown: { key: "unknown", icon: "statusUnknown" },
  none: { key: "none", icon: "none" },
  active: { key: "active", icon: "statusActive" },
  in_progress: { key: "progress", icon: "statusProgress" },
  resolved: { key: "resolved", icon: "statusResolved" },
} as const;

const modifierOf = (shown: Shown): keyof typeof LOOK => (shown.kind === "status" ? shown.status : shown.kind);

/** A place's status: its words, its icon and its colour. */
function StatusMark({ shown }: { shown: Shown }) {
  const r03 = useTranslations("R03");
  const status = useTranslations("status");
  const modifier = modifierOf(shown);
  const look = LOOK[modifier];
  const words = shown.kind === "checking" ? r03("checking") : status(look.key);
  return (
    <span className={`home-status home-status--${modifier}`} data-testid="home-status" data-status={modifier}>
      <span className={`home-ico home-ico--${look.icon}`} aria-hidden="true" />
      <span className="home-status__words">
        <ResidentText>{words}</ResidentText>
      </span>
    </span>
  );
}

/** "Not yet verified" under an alert status that rests only on unverified reports (AD-19). */
function Unverified({ shown }: { shown: Shown }) {
  const x02 = useTranslations("x02");
  if (shown.kind !== "status" || shown.status === "none" || shown.verified) return null;
  return (
    <ResidentText as="p" className="home-place__note" testId="home-unverified">
      {x02("notYetVerified")}
    </ResidentText>
  );
}

function BuildingRowView({ row, lang }: { row: BuildingRow; lang: LaunchCode }) {
  const r34 = useTranslations("R34");
  return (
    <li>
      {/* prefetch off: Next would otherwise fetch the building's page as soon as its link is on screen, which tells the server which buildings this resident chose (AD-3). Opening the page is the resident's own tap. */}
      <Link className="home-place tap" href={`/${lang}/buildings/${row.rsn}`} prefetch={false} data-testid={`home-building-${row.rsn}`}>
        <span className="home-place__text">
          <span className="home-place__name">{row.address ? <Isolated>{row.address}</Isolated> : <ResidentText>{r34("buildingByRsn", { rsn: row.rsn })}</ResidentText>}</span>
          <StatusMark shown={row.shown} />
          <Unverified shown={row.shown} />
        </span>
        <span className="home-ico home-ico--chevron" aria-hidden="true" />
      </Link>
    </li>
  );
}

function NeighbourhoodRowView({ row, name }: { row: NeighbourhoodRow; name: (id: string) => string }) {
  return (
    <li className="home-place" data-testid={`home-neighbourhood-${row.id}`}>
      <span className="home-place__text">
        <span className="home-place__name">
          <ResidentText>{name(row.id)}</ResidentText>
        </span>
        <StatusMark shown={row.shown} />
        <Unverified shown={row.shown} />
      </span>
    </li>
  );
}

/**
 * The current alerts. The seam for S04.08: it fills `feed.threads` with the approved, web-published, non-drill alerts and
 * replaces this plain list with the alert cards (R-03's `cvh-acard`, with origin, verification and a link to R-07).
 * Until a thread exists the feed has none, and the screen says so. A thread is never hidden behind "No current alerts".
 *
 * An alert text that is English standing in for a missing translation (`fallback_en`) is set left to right in English on
 * its own element, and the page says so once, in the words of x04 (content has no visible "[EN]"; only interface strings do).
 */
function CurrentAlerts({ threads, lang }: { threads: readonly FeedThread[]; lang: LaunchCode }) {
  const t = useTranslations("R03");
  const x04 = useTranslations("x04");
  if (threads.length === 0) {
    return (
      <div className="home-card" data-testid="no-current-alerts">
        <Stack gap="label">
          <ResidentText as="p" className="home-place__name">
            {t("noCurrentAlerts")}
          </ResidentText>
          <ResidentText as="p">{t("nothingActiveBody")}</ResidentText>
        </Stack>
      </div>
    );
  }
  const latestOf = (thread: FeedThread) => thread.entries[thread.entries.length - 1].text;
  const anyEnglish = threads.some((thread) => latestOf(thread).status === "fallback_en");
  return (
    <Stack gap="related">
      {anyEnglish && (
        <div className="home-note" role="note" data-testid="home-content-fallback">
          <Stack gap="subline">
            <ResidentText as="p" className="home-place__name">
              {x04("unavailable")}
            </ResidentText>
            <ResidentText as="p">{x04("unavailableBody", { lang: languageOf(lang).native })}</ResidentText>
          </Stack>
        </div>
      )}
      <ul className="home-list" data-testid="home-threads">
        {threads.map((thread) => {
          const text = latestOf(thread);
          const english = text.status === "fallback_en";
          return (
            <li className="home-thread" key={thread.id} data-testid={`home-thread-${thread.slug}`}>
              <p lang={english ? "en" : text.lang} dir={english ? "ltr" : "auto"}>
                {text.body}
              </p>
            </li>
          );
        })}
      </ul>
    </Stack>
  );
}

function neighbourhoodName(n: Translator): (id: string) => string {
  return (id) => (n.has(id) ? n(id) : id);
}

/**
 * Home (R-03, S02.11): the resident's chosen buildings first, each with its status in words, icon and colour and a link
 * to its page, then the neighbourhood, then the current alerts. With no chosen building it shows the neighbourhood view
 * and invites the resident to choose where they live (R-35).
 *
 * The server's answer is the same for everyone (AD-3): the whole neighbourhood's feed. The choices are read from this
 * phone and applied here; nothing about them is sent. The feed is fetched when the page opens and every 60 seconds
 * after, and an answer older than one already seen is discarded (use-feed.ts). `children` end the screen (the link to
 * "What I have told the CVH").
 */
export function HomeNow({ lang, children }: { lang: LaunchCode; children?: ReactNode }) {
  const t = useTranslations("R03");
  const neighbourhoods = useTranslations("neighbourhoods");
  const time = useTranslations("time");
  const choices = useChoices();
  const gate = useGateBuildingList();
  const own = useBuildingList(gate === null);
  const listState = gate ?? own.state;
  const list = listState.status === "ready" ? listState.list : null;
  const feed = useFeed(lang);

  const heading = <ResidentText as="h1">{t("alertsNow")}</ResidentText>;
  if (choices === undefined) {
    // The phone has not been read yet (the server render and the first render): nothing is claimed about any place.
    return (
      <Screen surface="resident" testId="home">
        <Stack gap="section-resident">
          {heading}
          {children}
        </Stack>
      </Screen>
    );
  }

  const chosen = choices?.buildings ?? [];
  const rows = homeRows({ chosen, list, view: { feed: feed.feed, failed: feed.failed } });
  const name = neighbourhoodName(neighbourhoods);
  const feedState = feed.feed ? "ready" : feed.failed ? "failed" : "loading";
  const translateTime = ((key: string, values?: Record<string, string | number>) => time(key, values)) as Parameters<typeof agoText>[1];
  // One neighbourhood is named; two are "Thorncliffe Park and Flemingdon Park".
  const neighbourhoodTitle = rows.neighbourhoods.length === 1 ? t("myNeighbourhood", { nbhd: name(rows.neighbourhoods[0].id) }) : t("neighbourhoods");

  return (
    <Screen surface="resident" testId="home">
      <div className="home" data-testid="home-now" data-feed={feedState}>
        <Stack gap="section-resident">
          {heading}

          {feed.failed && (
            <div className="home-note" role="status" data-testid="feed-failed">
              <ResidentText as="p">
                {feed.feed && feed.staleMs !== null ? t("feedFailedOld", { t: agoText(feed.staleMs, translateTime) }) : t("feedFailed")}
              </ResidentText>
            </div>
          )}

          {rows.buildings.length > 0 ? (
            <section data-testid="home-buildings">
              <Stack gap="related">
                <ResidentText as="h2" testId="home-buildings-title">
                  {t("myBuildings")}
                </ResidentText>
                <ul className="home-list">
                  {rows.buildings.map((row) => (
                    <BuildingRowView key={row.rsn} row={row} lang={lang} />
                  ))}
                </ul>
              </Stack>
            </section>
          ) : (
            <section aria-label={t("noBuildingChosen")} data-testid="home-invite">
              <Stack gap="related">
                <ResidentText as="p">{t("noBuildingLine")}</ResidentText>
                <Link className="choice-btn choice-btn--secondary tap home-invite" href={`/${lang}/choices/place`} data-testid="home-choose-building">
                  <ResidentText>{t("noBuildingChosen")}</ResidentText>
                </Link>
              </Stack>
            </section>
          )}

          <section data-testid="home-neighbourhoods">
            <Stack gap="related">
              <ResidentText as="h2">{neighbourhoodTitle}</ResidentText>
              <ul className="home-list">
                {rows.neighbourhoods.map((row) => (
                  <NeighbourhoodRowView key={row.id} row={row} name={name} />
                ))}
              </ul>
            </Stack>
          </section>

          {feed.feed && (
            <section data-testid="home-alerts">
              <Stack gap="related">
                <ResidentText as="h2">{t("currentAlerts")}</ResidentText>
                <CurrentAlerts threads={feed.feed.threads} lang={lang} />
              </Stack>
            </section>
          )}

          {children}
        </Stack>
      </div>
    </Screen>
  );
}
