import { ResidentText } from "../text/resident-text";
import "./not-911.css";

/** The catalog's `x01` group as a translator hands it: only the texts the block uses. */
export type Not911Translate = (key: "text" | "call" | "short") => string;

export type Not911Variant = "block" | "inline";

export type Not911Props = {
  /** `block`: "The CVH is not an emergency service." and "If someone is in danger, call 911." (guides, alerts, check-ins). `inline`: the one-line short form for a screen that is mostly a list (Be ready, the numbers page). */
  variant?: Not911Variant;
  /** The catalog's `x01` group in the page's language. */
  t: Not911Translate;
};

/**
 * The 911 block (AR-27, AD-16, UX-DR13; prototype X01_Not911): the one component that tells a resident the CVH is not an
 * emergency service and to call 911 if someone is in danger. Every guide, the essential-numbers page, and later every
 * alert and check-in screen draws this component and no copy of it, so the words and their translations live in one
 * place (the catalog's `x01` keys, which the string generator requires in every language) and a screen that forgets
 * it is found by `data-component="not-911"` (src/app/[lang]/ready/not911.test.tsx lists the screens that must have it).
 *
 * The "911" mark is decoration for the eye (aria-hidden): the sentence next to it carries the number for a screen
 * reader. A string that fell back to English reads as an isolated left-to-right English paragraph (ResidentText).
 */
export function Not911({ variant = "block", t }: Not911Props) {
  return (
    <div className="n911" data-component="not-911" data-variant={variant} role="note">
      <span className="n911__num" aria-hidden="true">
        911
      </span>
      {variant === "inline" ? (
        <ResidentText as="p">{t("short")}</ResidentText>
      ) : (
        <>
          <ResidentText as="p" className="n911__text">
            {t("text")}
          </ResidentText>
          <ResidentText as="p" className="n911__sub">
            {t("call")}
          </ResidentText>
        </>
      )}
    </div>
  );
}
