import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { guideView, orderGuides } from "@/modules/directory";
import { ContentText, ResidentText, Screen, Stack } from "@/ui";
import { Not911 } from "@/ui/emergency";
import { isLaunchCode, languageOf } from "@/i18n/languages";
import type { Translate } from "../../residentDates";
import { guideIconClass } from "./icons";
import { UnavailableNote } from "./unavailable-note";
import { loadResidentContent } from "./source";
import "./ready.css";

// Be ready (R-24, S02.10) is public and the same for every visitor: the six guides and a way to the numbers. Its one
// database read is kept in Next's data cache for 5 minutes (source.ts), shared by every visitor and every language, and
// a shared cache in front of the app keeps the page for 5 minutes and may serve it for 1 minute more (next.config.ts).
// The page is rendered on request, never at build: the guides come from the database, which a build does not reach
// (a language's static params would otherwise prerender it fifteen times).
export const dynamicParams = true;
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/ready">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "R24" });
  return { title: t("title") };
}

/**
 * "Be ready" (R-24): the guides, each with its reading time, and the essential numbers. The guides are the ones the
 * Hub reviewed offline (S02.09); a title that has no translation yet shows in English, set left to right.
 */
export default async function ReadyPage({ params }: PageProps<"/[lang]/ready">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);

  const t = (await getTranslations({ locale: lang })) as unknown as Translate;
  const x01 = (key: "text" | "call" | "short") => t(`x01.${key}`);
  const content = await loadResidentContent();
  const guides = orderGuides(content.guides.flatMap((record) => guideView(record, lang) ?? []));
  const showUnavailableNote = lang !== "en" && guides.some((guide) => guide.title.unavailable);

  return (
    <Screen surface="resident" testId="ready-page">
      <Stack gap="section-resident">
        <Stack gap="related">
          <ResidentText as="h1">{t("R24.title")}</ResidentText>
          <ResidentText as="p">{t("R24.lead")}</ResidentText>
          {showUnavailableNote && <UnavailableNote t={t} native={languageOf(lang).native} testId="ready-unavailable" />}
        </Stack>

        <section data-testid="ready-guides">
          <Stack gap="related">
            <ResidentText as="h2">{t("R24.guides")}</ResidentText>
            {guides.length > 0 ? (
              <Stack as="ul" gap="related">
                {guides.map((guide) => (
                  <li key={guide.id}>
                    <Link href={`/${lang}/ready/${guide.id}`} prefetch={false} className="ready-dest tap" data-testid={`ready-guide-${guide.id}`}>
                      {guideIconClass(guide.id) && <span className={`shell-ico ${guideIconClass(guide.id)} ready-dest__icon`} aria-hidden="true" />}
                      <span className="ready-dest__body">
                        <ContentText as="span" unavailable={guide.title.unavailable} className="ready-dest__title">
                          {guide.title.text}
                        </ContentText>
                        <ResidentText as="span" className="ready-dest__line" testId={`ready-read-${guide.id}`}>
                          {t("R24.readTime", { n: guide.readMins })}
                        </ResidentText>
                      </span>
                      <span className="shell-ico shell-ico--chevron shell-ico--mirror ready-dest__chevron" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </Stack>
            ) : (
              // The content could not be shown: say so, and the 911 block below still tells a resident what to do.
              <div className="ready-note" role="note" data-testid="ready-none">
                <ResidentText as="p">{t("R24.none")}</ResidentText>
              </div>
            )}
          </Stack>
        </section>

        <section data-testid="ready-more">
          <Stack gap="related">
            <ResidentText as="h2">{t("R24.more")}</ResidentText>
            <Link href={`/${lang}/ready/numbers`} prefetch={false} className="ready-dest tap" data-testid="ready-numbers">
              <span className="shell-ico shell-ico--phone ready-dest__icon" aria-hidden="true" />
              <span className="ready-dest__body">
                <ResidentText as="span" className="ready-dest__title">
                  {t("R24.numbers")}
                </ResidentText>
                <ResidentText as="span" className="ready-dest__line">
                  {t("R24.numbersLine")}
                </ResidentText>
              </span>
              <span className="shell-ico shell-ico--chevron shell-ico--mirror ready-dest__chevron" aria-hidden="true" />
            </Link>
          </Stack>
        </section>

        <Not911 variant="inline" t={x01} />
      </Stack>
    </Screen>
  );
}
