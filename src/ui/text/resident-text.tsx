import type { ReactNode } from "react";

/** The marker S02.01's gen-strings puts in front of an English string that stands in for a missing translation. */
export const FALLBACK_MARKER = "[EN] ";

/** True for a catalog string that is English standing in for a missing translation. */
export const isEnglishFallback = (text: string) => text.startsWith(FALLBACK_MARKER);

/**
 * All resident text goes through this: a translated string is rendered as is, and a string that fell back to English
 * ("[EN] Nothing is happening right now.") is an isolated left-to-right run in English. Without that, the bidi
 * algorithm lets the right-to-left page order the run ("Nothing is happening [EN] / .right now"), and a screen
 * reader reads it in the page's voice. <bdi> isolates the run from the text around it; lang and dir say what it is.
 */
export function ResidentText({ children }: { children: string }): ReactNode {
  if (!isEnglishFallback(children)) return children;
  return (
    <bdi lang="en" dir="ltr">
      {children}
    </bdi>
  );
}
