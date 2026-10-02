"use client";

import { usePathname } from "next/navigation";
import { useId, useRef, type MouseEvent } from "react";
import { pathInLanguage } from "@/i18n/paths";
import type { LaunchCode } from "@/i18n/languages";
import { ResidentText } from "../text/resident-text";
import { saveLanguageChoice } from "./language-choice";

export type LanguageOption = { code: LaunchCode; bcp47: string; dir: "ltr" | "rtl"; native: string };

export type LanguageControlProps = {
  current: LaunchCode;
  languages: readonly LanguageOption[];
  /** Translated text, passed in so this client component carries no catalog. */
  labels: { open: string; title: string; close: string; note: string };
};

/**
 * R-02: the header's language button and the sheet it opens. Choosing a language saves it in device choices
 * and loads the same page (path, query and hash) under the new language URL, so the page, the html lang and
 * dir, and the fonts all follow. The options are real links, so the URL works without script as well.
 */
export function LanguageControl({ current, languages, labels }: LanguageControlProps) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const active = languages.find(({ code }) => code === current) ?? languages[0];

  const choose = (event: MouseEvent<HTMLAnchorElement>, code: LaunchCode) => {
    event.preventDefault();
    saveLanguageChoice(code);
    if (code === current) {
      dialog.current?.close();
      return;
    }
    // A full page load, not a client navigation: <html lang dir> and the language's font are set by the layout.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`${pathInLanguage(pathname, code)}${window.location.search}${window.location.hash}`);
  };

  return (
    <>
      <button
        type="button"
        className="shell-langbtn tap"
        aria-label={`${labels.open}: ${active.native}`}
        aria-haspopup="dialog"
        data-testid="shell-lang-button"
        onClick={() => dialog.current?.showModal()}
      >
        <span className="shell-ico shell-ico--globe shell-ico--sm" aria-hidden="true" />
        <span className="shell-langbtn__name" lang={active.bcp47}>
          {active.native}
        </span>
        <span className="shell-ico shell-ico--chevronDown shell-ico--sm" aria-hidden="true" />
      </button>
      <dialog
        ref={dialog}
        className="shell-sheet"
        aria-labelledby={titleId}
        data-testid="shell-lang-sheet"
        // A click on the backdrop lands on the dialog element itself; a click inside lands on the panel.
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="shell-sheet__panel">
          <div className="shell-sheet__head">
            <span className="shell-ico shell-ico--globe" aria-hidden="true" />
            <h2 className="shell-sheet__title" id={titleId}>
              <ResidentText>{labels.title}</ResidentText>
            </h2>
            <button
              type="button"
              className="shell-iconbtn tap"
              aria-label={labels.close}
              onClick={() => dialog.current?.close()}
            >
              <span className="shell-ico shell-ico--close" aria-hidden="true" />
            </button>
          </div>
          <div className="shell-sheet__body">
            <p className="shell-sheet__note">
              <ResidentText>{labels.note}</ResidentText>
            </p>
            <ul className="shell-sheet__list" role="list">
              {languages.map((language) => (
                <li key={language.code}>
                  <a
                    className="shell-langopt tap"
                    href={pathInLanguage(pathname, language.code)}
                    lang={language.bcp47}
                    dir={language.dir}
                    hrefLang={language.bcp47}
                    aria-current={language.code === current ? "true" : undefined}
                    data-lang={language.code}
                    onClick={(event) => choose(event, language.code)}
                  >
                    <span>{language.native}</span>
                    {language.code === current && (
                      <span className="shell-langopt__check">
                        <span className="shell-ico shell-ico--check" aria-hidden="true" />
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </dialog>
    </>
  );
}
