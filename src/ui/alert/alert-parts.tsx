import Link from "next/link";
import type { ReactNode } from "react";
import { FALLBACK_MARKER, ResidentText, isEnglishFallback } from "../text/resident-text";
import type { AlertView, EntryView, OriginView, TextView, TypeView } from "./alert-view";
import "./alert-icons.css";
import "./alert.css";

// The marks the alert screens share (S04.08), each drawn once: X-13 the disruption types, X-02 the origin and verification, X-04 the machine
// translation label and the note for a text that is not available in the language, and the text itself. Components with no state and no
// hook, so a page renders them on the server and home on the phone alike.

/** X-13: each type is its icon and its words, so no type is carried by its icon alone. As the page's heading (`heading`) or as a line of a card. */
export function DisruptionTypes({ types, size = "md", heading = false }: { types: readonly TypeView[]; size?: "md" | "lg"; heading?: boolean }) {
  const items = types.map((type) => (
    <span className="alert-type" key={type.id} data-testid={`alert-type-${type.id}`}>
      <span className="alert-type__disc">
        <span className={`alert-ico alert-ico--${type.id}`} aria-hidden="true" />
      </span>
      <ResidentText>{type.word}</ResidentText>
    </span>
  ));
  const className = `alert-types alert-types--${size}`;
  return heading ? (
    <h1 className={className} data-testid="alert-types">
      {items}
    </h1>
  ) : (
    <p className={className} data-testid="alert-types">
      {items}
    </p>
  );
}

/** A string of the catalog for an attribute (an aria-label cannot hold the markup that isolates an English fallback), without its visible "[EN] " marker. */
const withoutMarker = (text: string) => (isEnglishFallback(text) ? text.slice(FALLBACK_MARKER.length) : text);

/**
 * X-02: who sent the alert and whether the Hub checked it, in the same words and the same place on every surface, with an icon and text and
 * never colour alone ("Verified by the Hub" is filled and has a check; "Not yet verified" is outlined and has its own mark). With `href`
 * the verification is the link to "what verified means" (R-28); without it, in a card that is itself a link, it is plain text.
 */
export function OriginMark({ origin, href }: { origin: OriginView; href?: string }) {
  const state = origin.verified ? "verified" : "unverified";
  const inner = (
    <>
      <span className={`alert-ico alert-ico--${state}`} aria-hidden="true" />
      <span data-testid="alert-verification">
        <ResidentText>{origin.verification}</ResidentText>
      </span>
      {href && (
        <span className="alert-verify__more">
          <ResidentText>{origin.whatMeans}</ResidentText>
        </span>
      )}
    </>
  );
  return (
    <div className="alert-origin" data-testid="alert-origin" data-verified={origin.verified}>
      <div className="alert-origin__who">
        {/* The Hub's name is a name: it is not translated, and it does not turn around in a right-to-left page. */}
        <span className="alert-origin__mark" aria-hidden="true" lang="en" dir="ltr">
          Hub
        </span>
        <span className="alert-origin__level" data-testid="alert-attribution">
          <ResidentText>{origin.attribution}</ResidentText>
        </span>
      </div>
      {href ? (
        <Link className={`alert-verify alert-verify--${state} tap`} href={href} prefetch={false} data-testid="alert-whatmeans" aria-label={`${withoutMarker(origin.verification)}. ${withoutMarker(origin.whatMeans)}`}>
          {inner}
        </Link>
      ) : (
        <span className={`alert-verify alert-verify--${state}`}>{inner}</span>
      )}
    </div>
  );
}

/** X-04: "Translated by machine, from English". The label of a text a model wrote. */
export function MachineMark({ view, testId = "alert-mt" }: { view: AlertView; testId?: string }) {
  return (
    <div className="alert-mt" data-testid={testId}>
      <span className="alert-mt__label">
        <span className="alert-ico alert-ico--language alert-ico--sm" aria-hidden="true" />
        <ResidentText>{view.machineLabel}</ResidentText>
      </span>
      <span>
        <ResidentText>{view.machineFrom}</ResidentText>
      </span>
    </div>
  );
}

/** X-04, "Translation not available": the text below is English because it could not be translated into the resident's language. */
export function UnavailableNote({ title, body, testId = "alert-unavailable" }: { title: string; body: string; testId?: string }) {
  return (
    <div className="alert-unavailable" role="note" data-testid={testId}>
      <span className="alert-ico alert-ico--language" aria-hidden="true" />
      <div className="alert-unavailable__body">
        <ResidentText as="p" className="alert-strong">
          {title}
        </ResidentText>
        <ResidentText as="p" className="alert-caption">
          {body}
        </ResidentText>
      </div>
    </div>
  );
}

/** The alert's words, in the language they are in: English standing in for a translation is set left to right in English on its own element. */
export function AlertText({ text, testId = "alert-text", className = "alert-text" }: { text: TextView; testId?: string; className?: string }) {
  return (
    <p className={className} lang={text.lang} dir={text.dir} data-testid={testId} data-translation={text.fallback ? "unavailable" : undefined}>
      {text.body}
    </p>
  );
}

/** "Read it in English": the English the machine translation was made from, a native disclosure so it works with no script. */
export function ShowEnglish({ english, summary, label, testId = "alert-english" }: { english: string; summary: string; label: string; testId?: string }): ReactNode {
  return (
    <details className="alert-english" data-testid={testId}>
      <summary className="tap" data-testid={`${testId}-toggle`}>
        <ResidentText>{summary}</ResidentText>
      </summary>
      <div className="alert-english__body">
        <ResidentText as="p" className="alert-caption">
          {label}
        </ResidentText>
        <p className="alert-text" lang="en" dir="ltr" data-testid={`${testId}-body`}>
          {english}
        </p>
      </div>
    </details>
  );
}

/**
 * One entry's text with what goes with it: the note when it is English for want of a translation, the label and "Read it in English" when a
 * machine wrote it. `testId` names the entry's own parts when the page draws more than one entry (the thread), so each is found on its own.
 */
export function EntryText({ view, entry, testId }: { view: AlertView; entry: EntryView; testId?: string }) {
  const own = (part: string) => (testId === undefined ? undefined : `${testId}-${part}`);
  return (
    <>
      {entry.text.fallback && <UnavailableNote title={view.unavailableTitle} body={view.unavailableBody} testId={own("unavailable")} />}
      <AlertText text={entry.text} testId={testId} />
      {entry.text.machine && <MachineMark view={view} testId={own("mt")} />}
      {entry.english !== null && <ShowEnglish english={entry.english} summary={view.showEnglish} label={view.originalLabel} testId={own("english")} />}
    </>
  );
}

/**
 * An older entry of the thread, below the alert that already shows the newest one with its note, label and English: the same words and the same
 * ways to read the English, in the compact form of a list (the unavailable note is one line, not the note with its explanation).
 */
export function ThreadEntryText({ view, entry, latest }: { view: AlertView; entry: EntryView; latest: boolean }) {
  const testId = `alert-entry-text-${entry.id}`;
  if (latest) return <AlertText text={entry.text} testId={testId} />;
  return (
    <>
      <AlertText text={entry.text} testId={testId} />
      {entry.text.fallback && (
        <ResidentText as="p" className="alert-caption" testId={`${testId}-unavailable`}>
          {view.unavailableTitle}
        </ResidentText>
      )}
      {entry.text.machine && <MachineMark view={view} testId={`${testId}-mt`} />}
      {entry.english !== null && <ShowEnglish english={entry.english} summary={view.showEnglish} label={view.originalLabel} testId={`${testId}-english`} />}
    </>
  );
}
