import Link from "next/link";
import { ContentText } from "../text/content-text";
import { FALLBACK_MARKER, ResidentText, isEnglishFallback } from "../text/resident-text";
import type { EntryView, OriginView, TextView, TypeView } from "./alert-view";
import "./alert-icons.css";
import "./alert.css";

// The marks the alert screens share (S04.08), each drawn once: X-13 the disruption types, X-02 the origin and verification, and the text itself.
// Product-owner decision 2026-10-09 (pilot): an alert shows its translation with no machine-translation label (X-04), no "Read it in English" and
// no note when it is English for want of a translation; that English is shown silently, marked lang="en" dir="ltr" for the browser and a screen
// reader. Components with no state and no hook, so a page renders them on the server and home on the phone alike.

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

/** The alert's words, in the language they are in: English standing in for a translation is set left to right in English on its own element. */
export function AlertText({ text, testId = "alert-text", className = "alert-text" }: { text: TextView; testId?: string; className?: string }) {
  return (
    <p className={className} lang={text.lang} dir={text.dir} data-testid={testId} data-translation={text.fallback ? "unavailable" : undefined}>
      {text.body}
    </p>
  );
}

/** One entry's text: its words in the resident's language, or the English standing in for them, with no label or note (decision 2026-10-09). */
export function EntryText({ entry, testId }: { entry: EntryView; testId?: string }) {
  return <AlertText text={entry.text} testId={testId} />;
}

/** An older entry of the thread, below the alert that already shows the newest one: the same words, in the compact form of a list. */
export function ThreadEntryText({ entry }: { entry: EntryView }) {
  return <AlertText text={entry.text} testId={`alert-entry-text-${entry.id}`} />;
}

/**
 * X-12, the tailored block (S04.09): the one line of advice for an alert that is for this phone's owner, under the words "What this means for you". It
 * names no group and does not say why it is shown, and it has no link to the choices or to "the version everyone gets": the alert itself is the
 * standard text, and this is only an addition to it. An advice line in English for want of a translation (the catalog marks it "[EN] ") is set
 * left to right in English on its own element, without the marker; the page says once that part of it is in English.
 */
export function TailoredAdvice({ title, line, testId }: { title: string; line: string; testId: string }) {
  const fallback = isEnglishFallback(line);
  return (
    <section className="alert-tailored" aria-label={withoutMarker(title)} data-testid={testId}>
      <ResidentText as="h3" className="alert-strong">
        {title}
      </ResidentText>
      <p className="alert-tailored__line">
        <span className="shell-ico shell-ico--chevron shell-ico--mirror shell-ico--sm" aria-hidden="true" />
        <ContentText as="span" unavailable={fallback} testId={`${testId}-line`}>
          {withoutMarker(line)}
        </ContentText>
      </p>
    </section>
  );
}
