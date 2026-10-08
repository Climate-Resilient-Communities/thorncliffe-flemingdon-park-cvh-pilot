import type { ReactNode } from "react";

/**
 * The rosette: a 12-lobed scalloped circle in a 24 × 24 box, r(θ) = 10.3 + 0.8·cos(12θ), drawn as 24 cubic segments (each handle on the
 * curve's tangent, so every peak and valley is smooth). Our own drawing, generated once; no outside image is used or copied.
 */
const ROSETTE =
  "M12 0.9C12.97 0.9 13.66 2.61 14.46 2.82C15.26 3.04 16.71 1.9 17.55 2.39C18.39 2.87 18.13 4.7 18.72 5.28C19.3 5.87 21.13 5.61 21.61 6.45C22.1 7.29 20.96 8.74 21.18 9.54C21.39 10.34 23.1 11.03 23.1 12C23.1 12.97 21.39 13.66 21.18 14.46C20.96 15.26 22.1 16.71 21.61 17.55C21.13 18.39 19.3 18.13 18.72 18.72C18.13 19.3 18.39 21.13 17.55 21.61C16.71 22.1 15.26 20.96 14.46 21.18C13.66 21.39 12.97 23.1 12 23.1C11.03 23.1 10.34 21.39 9.54 21.18C8.74 20.96 7.29 22.1 6.45 21.61C5.61 21.13 5.87 19.3 5.28 18.72C4.7 18.13 2.87 18.39 2.39 17.55C1.9 16.71 3.04 15.26 2.82 14.46C2.61 13.66 0.9 12.97 0.9 12C0.9 11.03 2.61 10.34 2.82 9.54C3.04 8.74 1.9 7.29 2.39 6.45C2.87 5.61 4.7 5.87 5.28 5.28C5.87 4.7 5.61 2.87 6.45 2.39C7.29 1.9 8.74 3.04 9.54 2.82C10.34 2.61 11.03 0.9 12 0.9Z";

/** The tick inside the rosette. A tick is not mirrored in right-to-left languages, like a check box's. */
const TICK = "M7.6 12.4l3 3 5.8-6";

/** The two drawn sizes, in CSS pixels: 16 beside small text (a Hub row), 20 beside body or caption text (a resident card). */
export const VERIFIED_SIZES = [16, 20] as const;
export type VerifiedSize = (typeof VERIFIED_SIZES)[number];

export interface VerifiedProps {
  /** True: confirmed (the brand blue rosette with a white tick). False: not confirmed (a grey outline, no tick). */
  confirmed: boolean;
  /** The words that say it ("Confirmed Oct 2, 2026", "Not confirmed"). Required: the badge is never shown alone. */
  children: ReactNode;
  size?: VerifiedSize;
  /** The element that holds the badge and its words. */
  as?: "p" | "span" | "div";
  className?: string;
  /** Rendered as data-testid. */
  testId?: string;
  /** For words that are English inside another language's page (a fallback): the line is then English, left to right. */
  lang?: string;
  dir?: "ltr" | "rtl";
}

/**
 * "Verified": a scalloped rosette beside the words that say whether something was confirmed (a provider by the Hub, a building's floors).
 * The rosette is decoration (aria-hidden): the words carry the meaning, so the badge is always rendered with them and never alone. It is
 * drawn in the brand blue with a white tick when confirmed and as a grey outline when not; in forced colours it takes the system's text
 * colour. It sits on the first line of its words at the start of the line, so it mirrors with the page.
 */
export function Verified({ confirmed, children, size = 16, as: Tag = "span", className, testId, lang, dir }: VerifiedProps) {
  return (
    <Tag
      className={`verified ${confirmed ? "verified--yes" : "verified--no"}${className ? ` ${className}` : ""}`}
      data-testid={testId}
      data-confirmed={confirmed ? "true" : "false"}
      lang={lang}
      dir={dir}
    >
      <span className="verified__mark">
        <svg className="verified__icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path className="verified__shape" d={ROSETTE} />
          {confirmed ? <path className="verified__tick" d={TICK} /> : null}
        </svg>
      </span>
      <span className="verified__text">{children}</span>
    </Tag>
  );
}
