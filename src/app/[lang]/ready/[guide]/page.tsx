import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { guideView } from "@/modules/directory";
import { ContentText, ResidentText, Screen, Stack } from "@/ui";
import { Not911 } from "@/ui/emergency";
import { UsageView } from "@/ui/usage";
import { isEnglishFallback } from "@/ui/text/resident-text";
import { isLaunchCode, languageOf } from "@/i18n/languages";
import { dayOf, withDate, type Translate } from "../../../residentDates";
import { guideIconClass } from "../icons";
import { UnavailableNote } from "../unavailable-note";
import { loadResidentContent } from "../source";
import { GuideHashFocus } from "./guide-hash-focus";
import { GUIDE_PARTS, headingId } from "./sections";
import "../ready.css";

// A guide (R-25, S02.10) is public and the same for every visitor, like the list it is opened from: one cached database
// read (source.ts), and a shared cache in front of the app keeps the page for 5 minutes (next.config.ts). The page is
// rendered on request, never at build: the guides come from the database, which a build does not reach. Any guide id
// is asked for on first request; one the database does not have is a 404 inside the shell.
export const dynamicParams = true;
export const dynamic = "force-dynamic";

const GUIDE_ID = /^[a-z0-9-]{1,40}$/;

/**
 * The guide, `null` when there is no such guide, or "unavailable" when no guide could be loaded at all (the database could
 * not be read: source.ts then returns none, and the page says so with the 911 block instead of a 404).
 */
async function loadGuide(lang: string, id: string) {
  if (!GUIDE_ID.test(id)) return null;
  const { guides } = await loadResidentContent();
  if (guides.length === 0) return "unavailable" as const;
  const record = guides.find((guide) => guide.id === id);
  return record ? guideView(record, lang) : null;
}

export async function generateMetadata({ params }: PageProps<"/[lang]/ready/[guide]">): Promise<Metadata> {
  const { lang, guide } = await params;
  if (!isLaunchCode(lang)) return {};
  const view = await loadGuide(lang, guide);
  return view && view !== "unavailable" ? { title: view.title.text } : {};
}

/**
 * One guide (R-25): the 911 block at the top, then what to do before, during and after, then who reviewed it and when it
 * was last updated. All three parts are on the page, each with a heading that has its own id, so a link ending in
 * `#during` (used by the alerts of E04) opens the guide at "During" with the focus on that heading (guide-hash-focus.tsx).
 * Text with no reviewed translation yet shows in English, left to right, and the page says so once.
 */
export default async function GuidePage({ params }: PageProps<"/[lang]/ready/[guide]">) {
  const { lang, guide: id } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  const view = await loadGuide(lang, id);
  if (!view) notFound();

  const t = (await getTranslations({ locale: lang })) as unknown as Translate;
  const x01 = (key: "text" | "call" | "short") => t(`x01.${key}`);
  const language = languageOf(lang);

  if (view === "unavailable") {
    return (
      <Screen surface="resident" testId="guide-page">
        <Stack gap="section-resident">
          <Stack gap="related">
            <Link href={`/${lang}/ready`} prefetch={false} className="ready-back tap" data-testid="guide-back">
              <span className="shell-ico shell-ico--back shell-ico--mirror shell-ico--sm" aria-hidden="true" />
              <ResidentText>{t("R24.title")}</ResidentText>
            </Link>
            <div className="ready-note" role="note" data-testid="guide-none">
              <ResidentText as="p">{t("R24.none")}</ResidentText>
            </div>
          </Stack>
          <Not911 variant="block" t={x01} />
          {/* The guide is not there to say when to call 911, so the page offers the call itself. */}
          <a
            className="ready-btn ready-btn--primary ready-btn--large tap"
            href="tel:911"
            data-testid="guide-none-call911"
            {...(isEnglishFallback(t("R31.call911")) ? { dir: "ltr", lang: "en" } : {})}
          >
            <span className="shell-ico shell-ico--phone" aria-hidden="true" />
            <ResidentText>{t("R31.call911")}</ResidentText>
          </a>
          <Link href={`/${lang}/ready/numbers`} prefetch={false} className="ready-link tap" data-testid="guide-numbers">
            <span className="shell-ico shell-ico--phone shell-ico--sm" aria-hidden="true" />
            <ResidentText>{t("R25.numbers")}</ResidentText>
            <span className="shell-ico shell-ico--chevron shell-ico--mirror shell-ico--sm" aria-hidden="true" />
          </Link>
        </Stack>
      </Screen>
    );
  }

  const showUnavailableNote = view.anyUnavailable && lang !== "en";

  return (
    <Screen surface="resident" testId="guide-page">
      <UsageView evt="guide_view" lang={lang} />
      <Stack gap="section-resident">
        <Stack gap="related">
          <Link href={`/${lang}/ready`} prefetch={false} className="ready-back tap" data-testid="guide-back">
            <span className="shell-ico shell-ico--back shell-ico--mirror shell-ico--sm" aria-hidden="true" />
            <ResidentText>{t("R24.title")}</ResidentText>
          </Link>
          <p className="ready-eyebrow">
            {guideIconClass(view.id) && <span className={`shell-ico shell-ico--sm ${guideIconClass(view.id)}`} aria-hidden="true" />}
            <ResidentText>{t("R25.guideWord")}</ResidentText>
            <span className="hide-basic">
              {" · "}
              <ResidentText>{t("R25.readTime", { n: view.readMins })}</ResidentText>
            </span>
          </p>
          <ContentText as="h1" unavailable={view.title.unavailable} testId="guide-title">
            {view.title.text}
          </ContentText>
          <GuideHashFocus openedDuring={t("R25.openedDuring")} />
          {showUnavailableNote &&
            (view.allUnavailable ? (
              <div className="ready-note" role="note" data-testid="guide-unavailable">
                <ResidentText as="p">{t("R25.unavailable", { lang: language.native })}</ResidentText>
              </div>
            ) : (
              <UnavailableNote t={t} native={language.native} testId="guide-unavailable" />
            ))}
        </Stack>

        <Stack gap="related">
          <Not911 variant="block" t={x01} />
          <div className="guide-when911" data-testid="guide-when911">
            <span className="shell-ico shell-ico--phone shell-ico--sm" aria-hidden="true" />
            <ContentText as="p" unavailable={view.when911.unavailable}>
              {view.when911.text}
            </ContentText>
          </div>
          <Link href={`/${lang}/ready/numbers`} prefetch={false} className="ready-link tap" data-testid="guide-numbers">
            <span className="shell-ico shell-ico--phone shell-ico--sm" aria-hidden="true" />
            <ResidentText>{t("R25.numbers")}</ResidentText>
            <span className="shell-ico shell-ico--chevron shell-ico--mirror shell-ico--sm" aria-hidden="true" />
          </Link>
        </Stack>

        <nav aria-label={t("R25.stagesNav")} data-testid="guide-jump">
          <Stack gap="label">
            <ResidentText as="p" className="ready-eyebrow">
              {t("R25.stagesNav")}
            </ResidentText>
            <ul className="guide-jump">
              {GUIDE_PARTS.map((section) => (
                <li key={section}>
                  <a href={`#${section}`} className="guide-jump__link tap" data-testid={`guide-jump-${section}`}>
                    <ResidentText>{t(`stages.${section}`)}</ResidentText>
                  </a>
                </li>
              ))}
            </ul>
          </Stack>
        </nav>

        {GUIDE_PARTS.map((section) => (
          <section key={section} id={section} className="guide-section" aria-labelledby={headingId(section)} data-testid={`guide-${section}`}>
            <Stack gap="related">
              <h2 id={headingId(section)} tabIndex={-1} className="guide-heading" data-testid={`guide-heading-${section}`}>
                <ResidentText>{t(`stages.${section}`)}</ResidentText>
              </h2>
              <ol className="guide-steps">
                {view.sections[section].map((line, index) => (
                  <ContentText key={index} as="li" unavailable={line.unavailable}>
                    {line.text}
                  </ContentText>
                ))}
              </ol>
            </Stack>
          </section>
        ))}

        <ResidentText as="p" className="ready-updated" testId="guide-reviewed">
          {withDate(t, "guides.reviewed", dayOf(view.lastUpdated), language.bcp47)}
        </ResidentText>
      </Stack>
    </Screen>
  );
}
