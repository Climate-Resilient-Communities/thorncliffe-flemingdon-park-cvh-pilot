"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { LaunchCode } from "@/i18n/languages";
import { Stack } from "../layout/stack";
import { ResidentText } from "../text/resident-text";
import { behindOf, shownOf, type Shown, type ThreadBehind } from "./home-view";
import { useFeed } from "./use-feed";
import "./home.css";

// How each thing a place can show looks: the catalog key of its words, and its icon. Every one has both, so a status is
// never colour alone (FR-D6, NFR-N2).
const LOOK = {
  checking: { key: "checking", icon: "statusUnknown" },
  unknown: { key: "unknown", icon: "statusUnknown" },
  none: { key: "none", icon: "none" },
  active: { key: "active", icon: "statusActive" },
  in_progress: { key: "progress", icon: "statusProgress" },
  resolved: { key: "resolved", icon: "statusResolved" },
} as const;

const modifierOf = (shown: Shown): keyof typeof LOOK => (shown.kind === "status" ? shown.status : shown.kind);

/** A place's status: its words, its icon and its colour. A place with nothing affecting it shows "Nothing active" with its own icon, never a blank. */
export function StatusMark({ shown }: { shown: Shown }) {
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
export function Unverified({ shown }: { shown: Shown }) {
  const x02 = useTranslations("x02");
  if (shown.kind !== "status" || shown.status === "none" || shown.verified) return null;
  return (
    <ResidentText as="p" className="home-place__note" testId="home-unverified">
      {x02("notYetVerified")}
    </ResidentText>
  );
}

/** The words of a thread's types ("Power, Water"): the X-13 catalog, a type it has no word for read as "Other". */
function useTypeWords() {
  const x13 = useTranslations("x13");
  return (types: readonly string[]) => types.map((type) => (x13.has(type) ? x13(type) : x13("other"))).join(", ");
}

/**
 * The threads behind a status (S05.06): one link each, to the alert (R-07), named by its types. Nothing when there are none (a place with no status, or one
 * whose status is `resolved`, whose closed thread the feed does not name).
 */
export function ThreadLinks({ behind, lang, testId }: { behind: readonly ThreadBehind[]; lang: LaunchCode; testId: string }) {
  const words = useTypeWords();
  if (behind.length === 0) return null;
  return (
    <ul className="home-threads" data-testid={testId}>
      {behind.map((thread) => (
        <li key={thread.slug}>
          {/* prefetch off, as every link to an alert: Next would otherwise fetch each alert's page as soon as its link is on screen. */}
          <Link className="home-thread tap" href={`/${lang}/alerts/${thread.slug}`} prefetch={false} data-testid={`status-thread-${thread.slug}`}>
            <ResidentText>{words(thread.types)}</ResidentText>
            <span className="home-ico home-ico--chevron" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The status of one building on its own page (S05.06): the same words, icon and "Not yet verified" as home, and the links to the threads behind it, from the
 * public feed the phone already polls (the same for every visitor, AD-3). The page itself is cached for minutes, so the status is read on the phone, not baked
 * into the page. While the feed has not answered it says so ("Checking"); it never shows a place it cannot tell about as having no alerts.
 */
export function BuildingStatus({ lang, rsn, neighbourhoodId }: { lang: LaunchCode; rsn: string; neighbourhoodId: string | null }) {
  const feed = useFeed(lang);
  const view = { feed: feed.feed, failed: feed.failed };
  const shown = shownOf(feed.feed?.places.buildings.find((place) => place.rsn === rsn), view);
  const behind = behindOf(shown, feed.feed, { kind: "building", rsn, neighbourhoodId });
  return (
    <section data-testid="building-status">
      <Stack gap="related">
        <StatusMark shown={shown} />
        <Unverified shown={shown} />
        <ThreadLinks behind={behind} lang={lang} testId="building-status-threads" />
      </Stack>
    </section>
  );
}
