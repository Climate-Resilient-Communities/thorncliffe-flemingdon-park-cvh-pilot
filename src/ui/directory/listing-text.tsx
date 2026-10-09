"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { ListingText } from "@/contracts/directory";
import type { LaunchCode } from "@/i18n/languages";
import { languageOf } from "@/i18n/languages";
import { ResidentText } from "../text/resident-text";

/** True when the listing put English where this language's text should be (`fallback_en` with `translation.unavailable`). */
export const isFallbackText = (text: ListingText): boolean => text.status === "fallback_en";

type BlockTag = "p" | "span" | "div" | "li";

/**
 * One text of a listing in the page language. Product-owner decision 2026-10-09 (pilot): every translation the release carries
 * is shown, with no machine-translation label, no "not reviewed" label and no notice that a text is not translated. Where the
 * release has only the English (`fallback_en`), the English is shown silently, marked for the browser and for a screen reader
 * instead: set left to right in English on the element itself, so its lines start at the left and wrap normally in a
 * right-to-left page.
 */
export function ListingBlock({
  text,
  as: Tag = "p",
  className,
  testId,
  contentLang,
}: {
  text: ListingText;
  as?: BlockTag;
  className?: string;
  testId?: string;
  /** The language this text is shown in when that is not the language of the page (search results in the language of the question): the element then says so for the browser and a screen reader. */
  contentLang?: LaunchCode;
}) {
  const asEnglish = isFallbackText(text);
  const own = !asEnglish && contentLang ? languageOf(contentLang) : null;
  return (
    <Tag
      className={className}
      data-testid={testId}
      lang={asEnglish ? "en" : own ? own.bcp47 : undefined}
      dir={asEnglish ? "ltr" : own ? own.dir : undefined}
      data-translation={asEnglish ? "unavailable" : undefined}
    >
      {text.body}
    </Tag>
  );
}

/**
 * The one-line 911 reminder (x01.short, "Not an emergency service. In danger? Call 911.") at the end of a screen that sends a
 * resident to a person: a search that found nothing, a provider's own page. An inline note, not the full 911 block.
 *
 * TODO(S02.10): replace this with the single 911 component's inline variant when S02.10 is merged, and delete this one.
 * The directory is not on S02.10's full-block list (the screens that carry the whole block), so it needs only the inline note.
 */
export function Inline911({ testId = "inline-911" }: { testId?: string }) {
  const t = useTranslations();
  return (
    <div className="dir-911" role="note" data-testid={testId}>
      <ResidentText as="p">{t("x01.short")}</ResidentText>
    </div>
  );
}

/**
 * X-14, "How they can help": the provider's emergency role, and 911 named for an emergency. The role often names a service
 * that is not an emergency service (a place to charge a phone, a warm room), so the box always says who to call in danger.
 */
export function HowTheyHelp({ role, contentLang }: { role: ListingText; contentLang?: LaunchCode }): ReactNode {
  const t = useTranslations();
  return (
    <div className="dir-help" data-testid="how-they-help">
      <ResidentText as="p" className="dir-help__label">
        {t("x14.label")}
      </ResidentText>
      <ListingBlock text={role} className="dir-help__text" testId="emergency-role" contentLang={contentLang} />
      <ResidentText as="p" className="dir-help__911" testId="help-911">
        {t("x01.call")}
      </ResidentText>
    </div>
  );
}
