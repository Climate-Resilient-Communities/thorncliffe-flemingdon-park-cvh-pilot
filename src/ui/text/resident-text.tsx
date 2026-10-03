import type { ReactNode } from "react";

/** The marker S02.01's gen-strings puts in front of an English string that stands in for a missing translation. */
export const FALLBACK_MARKER = "[EN] ";

/** True for a catalog string that is English standing in for a missing translation. */
export const isEnglishFallback = (text: string) => text.startsWith(FALLBACK_MARKER);

/** The elements ResidentText can be: the block that holds the whole text. */
export type ResidentTextTag = "p" | "h1" | "h2" | "h3" | "li" | "dt" | "dd" | "span" | "div" | "legend";

interface InlineProps {
  children: string;
  as?: undefined;
}

interface BlockProps {
  children: string;
  /** The element that holds the whole text. A fallback gets lang="en" dir="ltr" on this element itself. */
  as: ResidentTextTag;
  className?: string;
  /** Rendered as data-testid (the e2e tests find the element by it). */
  testId?: string;
  /** True: the text is English standing in for a missing translation although it has no "[EN]" marker (a page that says so once). */
  fallback?: boolean;
  /** -1: a script can give the element focus (a heading a screen moves focus to) but it is not a tab stop. */
  tabIndex?: -1;
}

/**
 * All resident text goes through this.
 *
 * Inline (no `as`): a translated string is rendered as is, and a string that fell back to English
 * ("[EN] Nothing is happening right now.") is an isolated left-to-right run in English, so it can sit inside
 * otherwise-translated text. Without that, the bidi algorithm lets the right-to-left page order the run
 * ("Nothing is happening [EN] / .right now"), and a screen reader reads it in the page's voice. <bdi> isolates the
 * run from the text around it; lang and dir say what it is.
 *
 * Block (`as`): use it when the text is the whole content of a paragraph, heading, list item or term. A fallback then
 * puts lang="en" dir="ltr" on that element itself, not on an inline <bdi> inside it. A <bdi> inside a right-to-left
 * block leaves the block right-to-left: text-align: start resolves to the right edge and the English lines are
 * ragged against the wrong edge. With dir="ltr" on the block the lines start at the left and wrap normally.
 */
export function ResidentText(props: InlineProps | BlockProps): ReactNode {
  const { children } = props;
  if (props.as === undefined) {
    if (!isEnglishFallback(children)) return children;
    return (
      <bdi lang="en" dir="ltr">
        {children}
      </bdi>
    );
  }
  const Tag = props.as;
  const fallback = props.fallback === true || isEnglishFallback(children);
  return fallback ? (
    <Tag className={props.className} data-testid={props.testId} tabIndex={props.tabIndex} lang="en" dir="ltr">
      {children}
    </Tag>
  ) : (
    <Tag className={props.className} data-testid={props.testId} tabIndex={props.tabIndex}>
      {children}
    </Tag>
  );
}
