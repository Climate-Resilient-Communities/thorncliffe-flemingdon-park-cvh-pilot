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

/**
 * True for a machine translation no person has reviewed (AD-11 pilot change, directory descriptions): shown in the page
 * language, but labelled "Machine-translated; not reviewed by a person" instead of x04.label.
 */
export const isUnreviewedMachineText = (text: ListingText): boolean => text.machine && !isFallbackText(text) && text.review_status !== "reviewed";

type BlockTag = "p" | "span" | "div" | "li";

/**
 * One text of a listing in the page language. Content has no visible "[EN]": a page says once that part of it is English
 * (UnavailableNote), and each English text is marked for the browser and for a screen reader instead, set left to right in
 * English on the element itself so its lines start at the left and wrap normally in a right-to-left page. A machine
 * translation shows its English original in place when `english` is on.
 */
export function ListingBlock({
  text,
  english = false,
  as: Tag = "p",
  className,
  testId,
  contentLang,
}: {
  text: ListingText;
  english?: boolean;
  as?: BlockTag;
  className?: string;
  testId?: string;
  /** The language this text is shown in when that is not the language of the page (search results in the language of the question): the element then says so for the browser and a screen reader. */
  contentLang?: LaunchCode;
}) {
  const original = english && text.machine;
  const asEnglish = original || isFallbackText(text);
  const own = !asEnglish && contentLang ? languageOf(contentLang) : null;
  return (
    <Tag
      className={className}
      data-testid={testId}
      lang={asEnglish ? "en" : own ? own.bcp47 : undefined}
      dir={asEnglish ? "ltr" : own ? own.dir : undefined}
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
 * machine-translated texts of one listing, and back. When one of those texts is a machine translation no person has
 * reviewed (`unreviewed`, AD-11 pilot change) the label says so: x04.unreviewed, "Machine-translated; not reviewed by a person". The toggle is described by the provider's name (`describedBy` is the
 * id of the name), so a screen reader moving through a list of identical buttons says which listing each belongs to.
 * "Original (English)" is a status: it is announced when the original is shown, and its element is always in the page so
 * that the announcement happens (an empty status takes no room).
 */
export function MachineLabel({ english, onToggle, describedBy, unreviewed = false }: { english: boolean; onToggle: () => void; describedBy: string; unreviewed?: boolean }) {
  const t = useTranslations();
  const name = languageOf("en").native;
  return (
    <div className="dir-mt" data-testid="machine-label" data-review={unreviewed ? "none" : "reviewed"}>
      <ResidentText as="span" className="dir-mt__label">
        {t(unreviewed ? "x04.unreviewed" : "x04.label")}
      </ResidentText>
      <button type="button" className="dir-link tap" aria-pressed={english} aria-describedby={describedBy} onClick={onToggle} data-testid="show-english">
        <ResidentText>{t("x04.showSource", { lang: name })}</ResidentText>
      </button>
      <span className="dir-mt__shown" role="status" data-testid="original-shown">
        {english ? <ResidentText>{t("x04.original", { lang: name })}</ResidentText> : null}
      </span>
    </div>
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
export function HowTheyHelp({ role, english, contentLang }: { role: ListingText; english: boolean; contentLang?: LaunchCode }): ReactNode {
  const t = useTranslations();
  return (
    <div className="dir-help" data-testid="how-they-help">
      <ResidentText as="p" className="dir-help__label">
        {t("x14.label")}
      </ResidentText>
      <ListingBlock text={role} english={english} className="dir-help__text" testId="emergency-role" contentLang={contentLang} />
      <ResidentText as="p" className="dir-help__911" testId="help-911">
        {t("x01.call")}
      </ResidentText>
    </div>
  );
}
