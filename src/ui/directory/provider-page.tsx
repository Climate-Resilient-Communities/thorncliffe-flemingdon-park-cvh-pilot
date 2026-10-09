"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { languageOf, type LaunchCode } from "@/i18n/languages";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { singleNeighbourhood } from "../usage/nbhd";
import { UsageView } from "../usage/usage";
import { isEnglishFallbackMessage, ResidentText } from "../text/resident-text";
import { CallHub } from "./call-hub";
import { formatMoment } from "./format";
import { Inline911, isFallbackText, UnavailableNote } from "./listing-text";
import { NumbersLink } from "./numbers-link";
import { ProviderSide } from "./provider-side";
import { ProviderView, type CategoryNames } from "./provider-view";
import type { MiniMapTiles } from "../map/mini-map";
import { useDirectory } from "./use-directory";
import "./directory.css";

/**
 * One provider's own page (R-12, and R-13 for the organisation: in the pilot's listing file a provider is the
 * organisation, so they are one page). Read from the same downloaded release as the list, on the phone.
 */
export function ProviderPage({ lang, id, tiles = null }: { lang: LaunchCode; id: string; tiles?: MiniMapTiles | null }) {
  const t = useTranslations();
  const directory = useDirectory(lang);
  const listing = directory.status === "ready" ? directory.listing : null;
  const provider = listing?.providers.find((p) => p.id === id) ?? null;
  const categories: CategoryNames = useMemo(() => new Map((listing?.categories ?? []).map((c) => [c.id, c.name])), [listing]);
  const locale = languageOf(lang).bcp47;

  const back = (
    <Link className="dir-back tap" href={`/${lang}/directory`} prefetch={false} data-testid="back-to-directory">
      <ResidentText>{t("directory.backToList")}</ResidentText>
    </Link>
  );

  return (
    <Screen surface="resident" testId="provider-page">
      {/* Counted once the provider is found, in the one neighbourhood the listing names, if it names one (S02.15). */}
      <UsageView evt="listing_view" lang={lang} nbhd={provider ? singleNeighbourhood(provider.neighbourhood_ids) : undefined} ready={provider !== null} />
      <Stack gap="section-resident">
        {back}
        {directory.status === "loading" && (
          <ResidentText as="p" testId="directory-loading">
            {t("directory.loading")}
          </ResidentText>
        )}
        {directory.status === "unavailable" && (
          <section className="dir-empty" data-testid="directory-unavailable">
            <Stack gap="related">
              <ResidentText as="h1">{t("directory.couldNotLoad")}</ResidentText>
              <ResidentText as="p">{t("directory.couldNotLoadBody")}</ResidentText>
              <CallHub testId="hub-call" />
              <NumbersLink lang={lang} />
            </Stack>
          </section>
        )}
        {directory.status === "ready" && !directory.current && (
          <ResidentText as="p" className="dir-updated" testId="directory-last-updated">
            {t("directory.lastUpdated", { time: formatMoment(directory.publishedAt, isEnglishFallbackMessage(t, "directory.lastUpdated") ? "en-CA" : locale) })}
          </ResidentText>
        )}
        {directory.status === "ready" && !provider && (
          <section className="dir-empty" data-testid="provider-not-found">
            <ResidentText as="h1">{t("R12.notFound")}</ResidentText>
          </section>
        )}
        {provider && (
          // From the desktop breakpoint (desktop.css): the details, then the side panel with the place and the quick actions. On a
          // phone the wrappers are stacks with the screen's gap and the panel is not displayed, so the page is the one column it was.
          <div className="provider-cols" data-layout="columns" data-testid="provider-columns">
            <div className="provider-main" data-testid="provider-main">
              {lang !== "en" && [provider.services, ...(provider.emergency_role ? [provider.emergency_role] : []), ...provider.subcategories].some(isFallbackText) && <UnavailableNote lang={lang} />}
              <ProviderView provider={provider} categories={categories} lang={lang} variant="page" />
              <Inline911 />
            </div>
            <ProviderSide provider={provider} lang={lang} tiles={tiles} />
          </div>
        )}
      </Stack>
    </Screen>
  );
}
