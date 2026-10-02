import { ResidentText } from "@/ui";
import type { Translate } from "../../residentDates";

/**
 * The one note a Be ready page shows when some of its text is English standing in for a missing translation (x04, the
 * catalog's "translation unavailable" wording): "Not yet available in this language. This has not been translated into
 * Urdu yet." The language is written in its own script (`native`). The text itself is marked on each line (ContentText).
 */
export function UnavailableNote({ t, native, testId }: { t: Translate; native: string; testId: string }) {
  return (
    <div className="ready-note" role="note" data-testid={testId}>
      <ResidentText as="p" className="ready-eyebrow">
        {t("x04.unavailable")}
      </ResidentText>
      <ResidentText as="p">{t("x04.unavailableBody", { lang: native })}</ResidentText>
    </div>
  );
}
