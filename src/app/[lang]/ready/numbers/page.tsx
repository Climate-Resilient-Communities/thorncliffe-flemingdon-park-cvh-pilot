import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { numbersView, type NumberView } from "@/modules/directory";
import { displayPhone } from "@/modules/places";
import { ContentText, ResidentText, Screen, Stack } from "@/ui";
import { Not911 } from "@/ui/emergency";
import { isEnglishFallback } from "@/ui/text/resident-text";
import { isLaunchCode, languageOf } from "@/i18n/languages";
import { dayOf, withDate, type Translate } from "../../../residentDates";
import { loadBuildingContacts, loadResidentContent } from "../source";
import { buildingContactCards } from "../view";
import { UnavailableNote } from "../unavailable-note";
import { ChosenContacts } from "./chosen-contacts";
import "../ready.css";

// The essential numbers (R-31, S02.10) are public and the same for every visitor, so a shared cache may keep the page:
// the Hub's numbers and every pilot building's contact are read once (source.ts) and sent to everyone. Which buildings
// are a resident's own is known only to their phone (AD-3): the page draws their contacts from the list in the browser.
// The page is rendered on request, never at build: the numbers come from the database, which a build does not reach.
export const dynamicParams = true;
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/ready/numbers">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "R31" });
  return { title: t("title") };
}

/** One number, led by what it is for: its purpose, then the number as the Hub writes it and a call link with a text label. */
function NumberRow({ row, t }: { row: NumberView; t: Translate }) {
  const call = t("R31.call");
  // A ten-digit number reads like the buildings' ones, (416) 542-8000; 211, 311 and 911 are left as they are.
  const shown = displayPhone(row.number);
  return (
    <li className="num" data-testid={`number-${row.id}`}>
      <ContentText as="p" unavailable={row.label.unavailable} className="num__purpose" testId={`number-${row.id}-purpose`}>
        {row.label.text}
      </ContentText>
      <div className="num__row">
        <bdi dir="ltr" lang="en" className="num__digits" data-testid={`number-${row.id}-digits`}>
          {shown}
        </bdi>
        {/* A "Call" that fell back to English makes the whole button English, left to right, so its words and the number read as one line. */}
        <a
          className="ready-btn ready-btn--secondary tap"
          href={`tel:${row.dial}`}
          aria-label={`${t("R31.calling", { what: row.label.text })}, ${shown}`}
          data-testid={`number-${row.id}-call`}
          {...(isEnglishFallback(call) ? { dir: "ltr", lang: "en" } : {})}
        >
          <span className="shell-ico shell-ico--phone shell-ico--sm" aria-hidden="true" />
          <ResidentText>{call}</ResidentText>
        </a>
      </div>
    </li>
  );
}

/**
 * The numbers page (R-31): 911 shown apart from the others, with when to call it; then 211, 311, Toronto Hydro and the
 * Hub, each with a `tel:` link and a text label; then the contacts of the buildings the resident chose (drawn in the
 * browser from the phone's choices). It says who checked the numbers and when the Hub's list was last updated. The 911
 * wording of the Hub's list is used when the list has it; if the list could not be loaded, the catalog's own wording is.
 */
export default async function NumbersPage({ params }: PageProps<"/[lang]/ready/numbers">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);

  const t = (await getTranslations({ locale: lang })) as unknown as Translate;
  const x01 = (key: "text" | "call" | "short") => t(`x01.${key}`);
  const language = languageOf(lang);
  const [content, contacts] = await Promise.all([loadResidentContent(), loadBuildingContacts()]);
  const numbers = numbersView(content.numbers, lang);
  const emergency = numbers.emergency;
  const cards = buildingContactCards(contacts, t, language.bcp47);
  const call911 = t("R31.call911");
  const showUnavailableNote = numbers.anyUnavailable && lang !== "en";

  return (
    <Screen surface="resident" testId="numbers-page">
      <Stack gap="section-resident">
        <Stack gap="related">
          <Link href={`/${lang}/ready`} prefetch={false} className="ready-back tap" data-testid="numbers-back">
            <span className="shell-ico shell-ico--back shell-ico--mirror shell-ico--sm" aria-hidden="true" />
            <ResidentText>{t("R24.title")}</ResidentText>
          </Link>
          <ResidentText as="h1">{t("R31.title")}</ResidentText>
          <ResidentText as="p" className="hide-basic">{t("R31.lead")}</ResidentText>
          {showUnavailableNote && <UnavailableNote t={t} native={language.native} testId="numbers-unavailable" />}
        </Stack>

        <section className="e911" aria-labelledby="numbers-911" data-testid="numbers-911">
          <ResidentText as="p" className="ready-eyebrow" testId="numbers-911-label">
            {t("R31.emergency")}
          </ResidentText>
          <p className="e911__num" id="numbers-911" data-testid="numbers-911-digits">
            {/* The number is read left to right, whatever the page's language. */}
            <bdi dir="ltr">{emergency?.number ?? "911"}</bdi>
          </p>
          {emergency?.when ? (
            <ContentText as="p" unavailable={emergency.when.unavailable} className="e911__when" testId="numbers-911-when">
              {emergency.when.text}
            </ContentText>
          ) : (
            <ResidentText as="p" className="e911__when" testId="numbers-911-when">
              {t("R31.emergencyWhen")}
            </ResidentText>
          )}
          <a
            className="ready-btn ready-btn--primary ready-btn--large tap"
            href={`tel:${emergency?.dial ?? "911"}`}
            data-testid="numbers-911-call"
            {...(isEnglishFallback(call911) ? { dir: "ltr", lang: "en" } : {})}
          >
            <span className="shell-ico shell-ico--phone" aria-hidden="true" />
            <ResidentText>{call911}</ResidentText>
          </a>
        </section>

        <section data-testid="numbers-others" className="ready-section">
          <ResidentText as="h2">{t("R31.others")}</ResidentText>
          {numbers.others.length > 0 ? (
            <ul className="numlist">
              {numbers.others.map((row) => (
                <NumberRow key={row.id} row={row} t={t} />
              ))}
            </ul>
          ) : (
            <div className="ready-note" role="note" data-testid="numbers-none">
              <ResidentText as="p">{t("R31.noOthers")}</ResidentText>
            </div>
          )}
        </section>

        <ChosenContacts
          title={t("R31.buildingTitle")}
          noneChosen={t("R31.noBuildingChosen")}
          chooseLabel={t("R31.chooseBuilding")}
          chooseHref={`/${lang}/choices/place`}
          // There is no floor-ambassador coverage yet (E01-S14), so the line must not promise an ambassador.
          noContact={t("R31.noBuildingNoAmb")}
          call={t("R31.call")}
          callIsEnglish={isEnglishFallback(t("R31.call"))}
          buildings={cards}
        />

        {numbers.lastUpdated !== null && (
          <ResidentText as="p" className="ready-updated" testId="numbers-checked">
            {withDate(t, "R31.checked", dayOf(numbers.lastUpdated), language.bcp47)}
          </ResidentText>
        )}

        <Not911 variant="inline" t={x01} />
      </Stack>
    </Screen>
  );
}
