"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { languageOf, type LaunchCode } from "@/i18n/languages";
import { Screen } from "../layout/screen";
import { Stack } from "../layout/stack";
import { isEnglishFallback, ResidentText } from "../text/resident-text";
import { HUB_PHONE } from "./contact";
import { formatMoment } from "./format";
import { isFallbackText, UnavailableNote } from "./listing-text";
import { ProviderView, type CategoryNames } from "./provider-view";
import { useDirectory } from "./use-directory";
import "./directory.css";

/**
 * One provider's own page (R-12, and R-13 for the organisation: in the pilot's listing file a provider is the
 * organisation, so they are one page). Read from the same downloaded release as the list, on the phone.
 */
export function ProviderPage({ lang, id }: { lang: LaunchCode; id: string }) {
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
              <a className="dir-call tap" href={`tel:+1${HUB_PHONE.replace(/\D/g, "")}`} data-testid="hub-call">
                <ResidentText>{t("R11.call", { phone: HUB_PHONE })}</ResidentText>
              </a>
              <Link className="dir-link tap" href={`/${lang}/ready/numbers`} prefetch={false} data-testid="numbers-link">
                <ResidentText>{t("directory.numbersLink")}</ResidentText>
              </Link>
            </Stack>
          </section>
        )}
        {directory.status === "ready" && !directory.current && (
          <ResidentText as="p" className="dir-updated" testId="directory-last-updated">
            {t("directory.lastUpdated", { time: formatMoment(directory.publishedAt, isEnglishFallback(t("directory.lastUpdated")) ? "en-CA" : locale) })}
          </ResidentText>
        )}
        {directory.status === "ready" && !provider && (
          <section className="dir-empty" data-testid="provider-not-found">
            <ResidentText as="h1">{t("R12.notFound")}</ResidentText>
          </section>
        )}
        {provider && (
          <>
            {lang !== "en" && [provider.services, ...(provider.emergency_role ? [provider.emergency_role] : []), ...provider.subcategories].some(isFallbackText) && <UnavailableNote lang={lang} />}
            <ProviderView provider={provider} categories={categories} lang={lang} variant="page" />
          </>
        )}
      </Stack>
    </Screen>
  );
}
