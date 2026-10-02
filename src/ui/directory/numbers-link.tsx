"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { LaunchCode } from "@/i18n/languages";
import { ResidentText } from "../text/resident-text";
import { NUMBERS_PAGE_EXISTS, numbersHref } from "./numbers-route";

/**
 * The sentence about the numbers page and the link to it, for the screens that say the directory could not load. Nothing
 * until the page exists (numbers-route.ts), so a resident is never sent to a page that is not there.
 */
export function NumbersLink({ lang }: { lang: LaunchCode }): ReactNode {
  const t = useTranslations();
  if (!NUMBERS_PAGE_EXISTS) return null;
  return (
    <>
      <ResidentText as="p">{t("directory.couldNotLoadNumbers")}</ResidentText>
      <Link className="dir-link tap" href={numbersHref(lang)} prefetch={false} data-testid="numbers-link">
        <ResidentText>{t("directory.numbersLink")}</ResidentText>
      </Link>
    </>
  );
}
