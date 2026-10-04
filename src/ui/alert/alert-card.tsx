import Link from "next/link";
import type { LaunchCode } from "@/i18n/languages";
import { ResidentText } from "../text/resident-text";
import type { AlertView, Translate } from "./alert-view";
import { AlertText, DisruptionTypes, OriginMark, TailoredAdvice } from "./alert-parts";
import "../shell/icons.css";

/**
 * An alert on home (R-03's `cvh-acard`, S04.08): its types (X-13), its words, who sent it and whether the Hub checked it (X-02, in the same
 * words as on the alert's own page), when it was posted, and the whole card is the link to the alert (R-07). The verification here is text, not
 * a second link: a card that is a link holds no other. An English text standing in for a translation is set in English on its own element (the
 * page says once that part of it is in English); a machine translation is labelled on the alert's page, where "Read it in English" is.
 *
 * Tailored on the phone (S04.09): `highlighted` draws the card with a heavier start edge (a shape as well as a colour, and no words, so it does
 * not say why), and `advice` adds the X-12 block with one line under the card, outside the link.
 */
export function AlertCard({
  view,
  lang,
  t,
  highlighted = false,
  advice = null,
  mayHaveEnded = false,
}: {
  view: AlertView;
  lang: LaunchCode;
  t: Translate;
  highlighted?: boolean;
  advice?: string | null;
  /** The card is read from a copy kept without signal and its valid-until has passed (S05.07): it says "may have ended" instead of being shown as current. */
  mayHaveEnded?: boolean;
}) {
  return (
    <li className="alert-card-item" data-highlighted={highlighted && !mayHaveEnded ? "true" : undefined} data-may-have-ended={mayHaveEnded ? "true" : undefined}>
      <Link className={highlighted && !mayHaveEnded ? "alert-card alert-card--mine tap" : mayHaveEnded ? "alert-card alert-card--ended tap" : "alert-card tap"} href={`/${lang}/alerts/${view.slug}`} prefetch={false} data-testid={`alert-card-${view.slug}`}>
        <DisruptionTypes types={view.types} />
        <AlertText text={view.current.text} testId={`alert-card-text-${view.slug}`} />
        <OriginMark origin={view.origin} />
        {mayHaveEnded ? (
          <ResidentText as="p" className="alert-caption alert-card__ended" testId={`alert-card-ended-${view.slug}`}>
            {view.mayHaveEnded}
          </ResidentText>
        ) : (
          <ResidentText as="p" className="alert-caption">
            {view.cardTime}
          </ResidentText>
        )}
        <span className="alert-card__open">
          <ResidentText>{t("R03.readAlert")}</ResidentText>
          <span className="shell-ico shell-ico--chevron shell-ico--mirror shell-ico--sm" aria-hidden="true" />
        </span>
      </Link>
      {advice !== null && <TailoredAdvice title={t("x12.title")} line={advice} testId={`alert-advice-${view.slug}`} />}
    </li>
  );
}
