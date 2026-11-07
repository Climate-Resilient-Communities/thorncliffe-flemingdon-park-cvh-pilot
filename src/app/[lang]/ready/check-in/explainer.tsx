import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { HUB_PHONE_E164 } from "@/contracts/hubNumber.generated";
import { displayPhone } from "@/contracts/phone";
import type { LaunchCode } from "@/i18n/languages";
import { ResidentText, Screen, Stack } from "@/ui";
import { Not911 } from "@/ui/emergency";
import { withIsolated } from "@/ui/text/isolated";
import type { Translate } from "../../../residentDates";
import "../ready.css";
import "@/ui/checkin/checkin.css";

/**
 * R-33: what a check-in is and is not (the prototype's words), that it is not an emergency service and when to call 911 (the 911 block), that
 * an ambassador on her floor will see her phone number and floor, and that a floor nobody covers is told at once with the Hub's number. Then how
 * to ask: on the text sign-up form (S07.02), with staff help at an event or the Hub (S07.03), or, for someone who already gets the texts, on
 * the page where they change their choices, whose link they ask for by text (S07.06).
 *
 * `firstRun`: the same page as a step of the first run (after R-26 asked for a check-in and R-35, UAT 2026-11-04), with no way
 * back to Be ready and a Continue to the first run's finished step.
 */
export async function CheckinExplainer({ lang, firstRun = false }: { lang: LaunchCode; firstRun?: boolean }) {
  const t = (await getTranslations({ locale: lang })) as unknown as Translate;
  const x01 = (key: "text" | "call" | "short") => t(`x01.${key}`);
  const hub = displayPhone(HUB_PHONE_E164);
  const hubLink = (
    <a className="checkin-link" href={`tel:${HUB_PHONE_E164}`} data-testid="checkin-page-hub">
      {hub}
    </a>
  );

  return (
    <Screen surface="resident" testId="checkin-page">
      <Stack gap="section-resident">
        <Stack gap="related">
          {!firstRun && (
            <Link href={`/${lang}/ready`} prefetch={false} className="ready-back tap" data-testid="checkin-page-back">
              <span className="shell-ico shell-ico--back shell-ico--mirror shell-ico--sm" aria-hidden="true" />
              <ResidentText>{t("R24.title")}</ResidentText>
            </Link>
          )}
          <ResidentText as="h1">{t("R33.title")}</ResidentText>
        </Stack>

        <section className="checkin-consent" aria-labelledby="checkin-page-what-title" data-testid="checkin-page-what">
          <Stack gap="related">
            <h2 id="checkin-page-what-title" data-testid="checkin-page-what-title">
              <ResidentText>{t("R33.whatTitle")}</ResidentText>
            </h2>
            <ResidentText as="p">{t("R33.what")}</ResidentText>
            <ResidentText as="p">{t("checkin.isNot")}</ResidentText>
            <ResidentText as="p" className="checkin-consent__sees">
              {t("R33.notEmergency")}
            </ResidentText>
          </Stack>
        </section>

        <Not911 variant="block" t={x01} />

        <Stack gap="related">
          <ResidentText as="p" className="checkin-consent__sees" testId="checkin-page-sees">
            {t("checkin.sees")}
          </ResidentText>
          <p data-testid="checkin-page-coverage" data-tap-exempt="inline-text">{withIsolated((number) => t("checkin.noCoverage", { hub: number }), hubLink)}</p>
        </Stack>

        <section className="ready-section" aria-labelledby="checkin-page-how-title" data-testid="checkin-page-how">
          <Stack gap="related">
            <h2 id="checkin-page-how-title" data-testid="checkin-page-how-title">
              <ResidentText>{t("checkin.howTitle")}</ResidentText>
            </h2>
            <ResidentText as="p">{t("checkin.howNew")}</ResidentText>
            <div>
              <Link href={`/${lang}/text-alerts`} prefetch={false} className="ready-btn ready-btn--primary tap" data-testid="checkin-page-signup">
                <ResidentText>{t("R05.title")}</ResidentText>
              </Link>
            </div>
            <ResidentText as="p" testId="checkin-page-help">
              {t("checkin.howHelp")}
            </ResidentText>
            <ResidentText as="p" testId="checkin-page-subscribed">
              {t("checkin.howSubscribed")}
            </ResidentText>
            <ResidentText as="p" testId="checkin-page-link-by-text">
              {t("subscriptionEdit.expiredHow")}
            </ResidentText>
          </Stack>
        </section>

        {firstRun && (
          <div>
            <Link href={`/${lang}/welcome/done`} prefetch={false} className="ready-btn ready-btn--secondary tap" data-testid="checkin-page-continue">
              <ResidentText>{t("R33.continue")}</ResidentText>
            </Link>
          </div>
        )}
      </Stack>
    </Screen>
  );
}
