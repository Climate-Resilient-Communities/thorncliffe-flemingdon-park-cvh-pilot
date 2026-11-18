"use client";

import { useTranslations } from "next-intl";
import { ResidentText } from "../text/resident-text";
import "./directory.css";

/** The subcategory id of the public cooling spaces (the catalogue's "Cooling Spaces", subcategoryId in filters.ts). */
export const COOLING_SPACES = "cooling spaces";

/**
 * One tap to the public cooling spaces (resident testing, session 2, #9: finding them took a long scroll through two levels of
 * filters). The same filter as "Cooling Spaces" under "What kind of place?", on and off, its state told by aria-pressed. It says the
 * places are open to everyone, so a building's cooling room (for its own residents) is not taken for one.
 */
export function QuickCooling({ on, onChange, testId }: { on: boolean; onChange: (on: boolean) => void; testId: string }) {
  const t = useTranslations();
  return (
    <button type="button" className="quick-cooling tap" aria-pressed={on} onClick={() => onChange(!on)} data-testid={testId}>
      <span className="quick-cooling__ico" aria-hidden="true" />
      <span className="quick-cooling__text">
        <ResidentText>{t("directory.quickCooling")}</ResidentText>
        <ResidentText as="span" className="quick-cooling__line">
          {t("directory.quickCoolingLine")}
        </ResidentText>
      </span>
    </button>
  );
}
