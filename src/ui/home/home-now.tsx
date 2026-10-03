"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import type { BuildingList } from "@/contracts/buildingList";
import type { DeviceChoices } from "@/contracts/deviceChoices";
import type { FeedThread } from "@/contracts/feed";
import { languageOf, type LaunchCode } from "@/i18n/languages";
import { useBuildingList, useChoices } from "../choices/use-choices";
import { useGateBuildingList } from "../choices/building-list-context";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { AlertCard, alertView, type Translate as AlertTranslate } from "../alert";
import { Not911 } from "../emergency";
import { Isolated } from "../text/isolated";
import { ResidentText, isEnglishFallback } from "../text/resident-text";
import { agoText } from "./feed-poll";
import { homeRows, type BuildingRow, type NeighbourhoodRow, type Shown } from "./home-view";
import { adviceFor, deviceProfile, tailorThreads } from "./tailoring";
import { useFeed } from "./use-feed";
import "../choices/choices.css";
import "./home.css";

// The Every day destinations of the prototype's R-03, in its order: find help (the directory, R-09), the map (R-14) and
// be ready (R-24). Each one's words are the catalog's R03 key of the same name and `${key}Line`.
const DESTINATIONS = [
  { key: "findHelp", icon: "search", path: "/directory" },
  { key: "map", icon: "map", path: "/map" },
  { key: "beReady", icon: "ready", path: "/ready" },
] as const;

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
 * The current alerts (S04.08): each open, web-published, non-drill thread of the feed as a card (R-03's `cvh-acard`): its types (X-13), its
 * words in the page language, who sent it and whether the Hub checked it (X-02) and when it was posted, the whole card the link to the alert
 * (R-07). Until a thread exists the feed has none, and the screen says so. A thread is never hidden behind "No current alerts".
 *
 * An alert text that is English standing in for a missing translation (`fallback_en`) is set left to right in English on its own element, and
 * the page says so once, in the words of x04 (content has no visible "[EN]"; only interface strings do). Every "ago" is measured against the
 * feed's own `server_now`, never this phone's clock.
 */
function CurrentAlerts({
  threads,
  serverNow,
  lang,
  choices,
  list,
}: {
  threads: readonly FeedThread[];
  serverNow: string;
  lang: LaunchCode;
  choices: DeviceChoices | null;
  list: BuildingList | null;
}) {
  const t = useTranslations("R03");
  const x04 = useTranslations("x04");
  const tailoredCatalog = useTranslations("tailored");
  const all = useTranslations() as unknown as AlertTranslate;
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
  // Tailored here, on the phone (S04.09): the profile of this phone orders and marks the feed's threads and picks the one line of advice; no alert
  // is dropped, and nothing of the choices leaves the page.
  const profile = deviceProfile(choices, list);
  const chosenGroups = choices?.groups ?? [];
  const adviceLines = (type: string, group: string): readonly string[] | undefined => {
    const key = `${type}.${group}`;
    if (!tailoredCatalog.has(key)) return undefined;
    const lines = tailoredCatalog.raw(key) as unknown;
    return Array.isArray(lines) ? lines.filter((line): line is string => typeof line === "string") : undefined;
  };
  const cards = tailorThreads(threads, profile).map(({ thread, matched, highlighted }) => ({
    view: alertView(thread, { lang, serverNow: new Date(serverNow), t: all }),
    highlighted,
    advice: matched ? adviceFor(thread.types, chosenGroups, adviceLines) : null,
  }));
  const views = cards.map((card) => card.view);
  const anyEnglish = views.some((view) => view.current.text.fallback) || cards.some((card) => card.advice !== null && isEnglishFallback(card.advice));
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
      <ul className="alert-card-list" data-testid="home-threads">
        {cards.map(({ view, highlighted, advice }) => (
          <AlertCard key={view.slug} view={view} lang={lang} t={all} highlighted={highlighted} advice={advice} />
        ))}
      </ul>
    </Stack>
  );
}

function neighbourhoodName(n: Translator): (id: string) => string {
  return (id) => (n.has(id) ? n(id) : id);
}

/**
 * "Every day" (the prototype's R-03): large links to find help (the directory), the map and be ready. They are the same
 * for every resident and need nothing from the phone, so the server render has them too, and the 911 notice sits directly
 * under them in every state of the screen.
 */
function EveryDay({ lang }: { lang: LaunchCode }) {
  const t = useTranslations("R03");
  return (
    <section data-testid="home-every-day">
      <Stack gap="stack">
        <ResidentText as="h2" testId="home-every-day-title">
          {t("everyday")}
        </ResidentText>
        <ul className="home-list home-list--dest">
          {DESTINATIONS.map((d) => (
            <li key={d.key}>
              {/* prefetch off, as the shell's navigation links to the same pages: Next would otherwise fetch each page as soon as its link is on screen. */}
              <Link className="home-dest tap" href={`/${lang}${d.path}`} prefetch={false} data-testid={`home-dest-${d.key}`}>
                <span className={`home-ico home-ico--${d.icon}`} aria-hidden="true" />
                <span className="home-dest__text">
                  <ResidentText as="span">{t(d.key)}</ResidentText>
                  <ResidentText as="span" className="home-dest__line">
                    {t(`${d.key}Line`)}
                  </ResidentText>
                </span>
                <span className="home-ico home-ico--chevron" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </Stack>
    </section>
  );
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
  const x01 = useTranslations("x01");
  const choices = useChoices();
  const gate = useGateBuildingList();
  const own = useBuildingList(gate === null);
  const listState = gate ?? own.state;
  const list = listState.status === "ready" ? listState.list : null;
  const feed = useFeed(lang);

  const heading = <ResidentText as="h1">{t("alertsNow")}</ResidentText>;
  if (choices === undefined) {
    // The phone has not been read yet (the server render and the first render): nothing is claimed about any place.
    // "Every day" is the same for everyone, so it is here, with the notice directly under it and the link last.
    return (
      <Screen surface="resident" testId="home">
        <Stack gap="section-resident">
          {heading}
          <EveryDay lang={lang} />
          <Not911 variant="inline" t={x01} />
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

          {/* One live region, always mounted, so a screen reader hears the note when it is put into it. Its text does not
              change while the failure lasts (the words of `feedFailed`, with no time in them), so it is announced once and
              not at every poll. How old the feed on screen is does change, so that line is outside the live region. */}
          <div className="home-live" role="status" data-testid="feed-status">
            {feed.failed && (
              <div className="home-note" data-testid="feed-failed">
                <ResidentText as="p">{t("feedFailed")}</ResidentText>
              </div>
            )}
          </div>
          {feed.failed && feed.feed && feed.staleMs !== null && (
            <div className="home-note" data-testid="feed-last-loaded">
              <ResidentText as="p">{t("feedFailedOld", { t: agoText(feed.staleMs, translateTime) })}</ResidentText>
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
            <section aria-labelledby="home-invite-line" data-testid="home-invite">
              <Stack gap="related">
                <div id="home-invite-line">
                  <ResidentText as="p">{t("noBuildingLine")}</ResidentText>
                </div>
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
                <CurrentAlerts threads={feed.feed.threads} serverNow={feed.feed.server_now} lang={lang} choices={choices} list={list} />
              </Stack>
            </section>
          )}

          <EveryDay lang={lang} />

          {/* The short 911 notice (owner decisions 36 and 37; prototype R-03's X01_Not911 inline), the shared component:
              directly under "Every day", above `children` (the link to "What I have told the CVH"). */}
          <Not911 variant="inline" t={x01} />

          {children}
        </Stack>
      </div>
    </Screen>
  );
}
