"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { ListingText } from "@/contracts/directory";
import type { LaunchCode } from "@/i18n/languages";
import { languageOf } from "@/i18n/languages";
import { ResidentText } from "../text/resident-text";

/** True when the listing put English where this language's text should be (`fallback_en` with `translation.unavailable`). */
export const isFallbackText = (text: ListingText): boolean => text.status === "fallback_en";

/** True when a model translated this text (or it was converted from one that was): it carries the machine-translation label. */
export const isMachineText = (text: ListingText): boolean => text.machine;

type BlockTag = "p" | "span" | "div" | "li";

/**
 * One text of a listing in the page language. Content has no visible "[EN]": a page says once that part of it is English
 * (UnavailableNote), and each English text is marked for the browser and for a screen reader instead, set left to right in
 * English on the element itself so its lines start at the left and wrap normally in a right-to-left page. A machine
 * translation shows its English original in place when `english` is on.
 */
export function ListingBlock({ text, english = false, as: Tag = "p", className, testId }: { text: ListingText; english?: boolean; as?: BlockTag; className?: string; testId?: string }) {
  const original = english && text.machine;
  const asEnglish = original || isFallbackText(text);
  return (
    <Tag
      className={className}
      data-testid={testId}
      lang={asEnglish ? "en" : undefined}
      dir={asEnglish ? "ltr" : undefined}
      data-translation={isFallbackText(text) ? "unavailable" : text.machine ? (original ? "original" : "machine") : undefined}
    >
      {original ? text.original.body : text.body}
    </Tag>
  );
}

/**
 * The one note of a page that some of its text is English standing in for a missing translation, in the catalog's x04
 * wording ("Not yet available in this language. This has not been translated into Urdu yet."), the language in its own script.
 */
export function UnavailableNote({ lang, testId = "directory-unavailable-note" }: { lang: LaunchCode; testId?: string }) {
  const t = useTranslations();
  return (
    <div className="dir-note" role="note" data-testid={testId}>
      <ResidentText as="p" className="dir-note__title">
        {t("x04.unavailable")}
      </ResidentText>
      <ResidentText as="p">{t("x04.unavailableBody", { lang: languageOf(lang).native })}</ResidentText>
    </div>
  );
}

/**
 * The machine-translation label (x04) and "Read it in English": a toggle that shows the English original in place of the
 * machine-translated texts of one listing, and back.
 */
export function MachineLabel({ english, onToggle }: { english: boolean; onToggle: () => void }) {
  const t = useTranslations();
  const name = languageOf("en").native;
  return (
    <div className="dir-mt" data-testid="machine-label">
      <ResidentText as="span" className="dir-mt__label">
        {t("x04.label")}
      </ResidentText>
      <button type="button" className="dir-link tap" aria-pressed={english} onClick={onToggle} data-testid="show-english">
        <ResidentText>{t("x04.showSource", { lang: name })}</ResidentText>
      </button>
      {english && (
        <ResidentText as="span" className="dir-mt__shown" testId="original-shown">
          {t("x04.original", { lang: name })}
        </ResidentText>
      )}
    </div>
  );
}

/**
 * X-14, "How they can help": the provider's emergency role, and 911 named for an emergency. The role often names a service
 * that is not an emergency service (a place to charge a phone, a warm room), so the box always says who to call in danger.
 */
export function HowTheyHelp({ role, english }: { role: ListingText; english: boolean }): ReactNode {
  const t = useTranslations();
  return (
    <div className="dir-help" data-testid="how-they-help">
      <ResidentText as="p" className="dir-help__label">
        {t("x14.label")}
      </ResidentText>
      <ListingBlock text={role} english={english} className="dir-help__text" testId="emergency-role" />
      <ResidentText as="p" className="dir-help__911" testId="help-911">
        {t("x01.call")}
      </ResidentText>
    </div>
  );
}
