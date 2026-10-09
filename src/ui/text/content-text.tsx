import type { ReactNode } from "react";
import type { ResidentTextTag } from "./resident-text";

interface InlineProps {
  children: string;
  /** True: English standing in for a missing, unreviewed or stale translation (`translation.unavailable`). */
  unavailable: boolean;
  as?: undefined;
}

interface BlockProps {
  children: string;
  unavailable: boolean;
  as: ResidentTextTag;
  className?: string;
  testId?: string;
}

/**
 * Guide and numbers text (content the Hub reviewed offline, S02.09), as ResidentText is for the interface's own strings.
 * Content has no visible "[EN]" and no note that it is English (product-owner decision 2026-10-09, pilot): each English
 * text is marked for the browser and for a screen reader instead: it is set left to right in English (`lang="en" dir="ltr"`) on the element
 * itself, so its lines start at the left and wrap normally in a right-to-left page, and the voice is English.
 * Inline (no `as`) an English text is an isolated run (<bdi>), so it can sit inside a translated line.
 * `data-translation="unavailable"` lets a test find them.
 */
export function ContentText(props: InlineProps | BlockProps): ReactNode {
  const { children, unavailable } = props;
  if (props.as === undefined) {
    return unavailable ? (
      <bdi lang="en" dir="ltr" data-translation="unavailable">
        {children}
      </bdi>
    ) : (
      children
    );
  }
  const Tag = props.as;
  return unavailable ? (
    <Tag className={props.className} data-testid={props.testId} lang="en" dir="ltr" data-translation="unavailable">
      {children}
    </Tag>
  ) : (
    <Tag className={props.className} data-testid={props.testId}>
      {children}
    </Tag>
  );
}
