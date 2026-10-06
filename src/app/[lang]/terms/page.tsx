import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { FALLBACK_MARKER, ResidentText, Screen, Stack } from "@/ui";
import { isLaunchCode, languageOf } from "@/i18n/languages";
import { failClosedEnvironment } from "@/platform/config/env";
import { termsPageMode, termsPageView, type TermsText } from "@/modules/subscriptions";
import { residentDataDeletedOnCached } from "../../pilotEnd";
import "./terms.css";

// Rendered on request from the committed files, for the one fact that is not in them (S09.08): once the end-of-pilot purge has completed, the day the
// pilot's resident data was deleted, read from the purge's record through Next's data cache (src/app/pilotEnd.ts); a page that cannot read it is the terms
// without that line. The page reads no cookie and no header.
export const dynamic = "force-dynamic";

/**
 * One text of the terms, as the whole content of its element: a translation as is, and English standing in for a
 * missing one with lang="en" dir="ltr" on the element itself (so it reads and wraps from the left in a right-to-left
 * page). `marked` puts the visible "[EN]" in front of it. The terms come from the content pipeline, not from UI string
 * keys, so where the page says once that part of it is in English the body paragraphs go without the marker.
 */
function TermsBlock({ text, as, marked, className }: { text: TermsText; as: "h1" | "h2" | "p"; marked: boolean; className?: string }) {
  const english = text.unavailable;
  return (
    <ResidentText as={as} className={className} fallback={english}>
      {english && marked ? FALLBACK_MARKER + text.text : text.text}
    </ResidentText>
  );
}

export async function generateMetadata({ params }: PageProps<"/[lang]/terms">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const view = termsPageView(lang);
  if (termsPageMode(view, failClosedEnvironment()) === "hidden") return {};
  // An unpublished draft is for staff to check: keep it out of search results.
  return { title: view.document.title.text, robots: view.status === "published" ? undefined : { index: false, follow: false } };
}

/**
 * The terms and privacy page (S07.01, R-xx): the text, its version, owner and last-updated date, in the language of
 * the URL, and once the end-of-pilot purge has completed (S09.08) the day the pilot's resident data was deleted.
 * Terms that are not published (a placeholder, no counsel review, or a change after it) are never shown as
 * final: in production the page is a 404, so a resident cannot take a draft for the terms; in a preview or in
 * development the draft is shown under a "Draft: not yet published" banner with the reasons, so staff can check it.
 */
export default async function TermsPage({ params }: PageProps<"/[lang]/terms">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);

  const view = termsPageView(lang);
  const mode = termsPageMode(view, failClosedEnvironment());
  if (mode === "hidden") notFound();

  const t = await getTranslations({ locale: lang, namespace: "terms" });
  // S09.08: the day the pilot's resident data was deleted, once the end-of-pilot purge has completed (null before, and when it cannot be read).
  const deletedOn = await residentDataDeletedOnCached();
  const { document } = view;
  const someInEnglish = [document.title, ...document.sections.flatMap((s) => [s.heading, ...s.lines])].some((x) => x.unavailable);
  // Where the page says once that part of it is in English, its body paragraphs go without the per-paragraph "[EN]".
  const showNote = someInEnglish && lang !== "en";

  return (
    <Screen surface="resident" testId="terms">
      {/* The page is text only and scrolls in the shell's main: a keyboard needs something in it to focus to scroll (WCAG 2.1.1), so the text is one region that takes focus. */}
      <div className="terms-body" role="region" aria-labelledby="terms-title" tabIndex={0} data-testid="terms-body">
      <Stack gap="stack">
        {view.status === "draft" && (
          <div className="terms-draft" role="note" data-testid="terms-draft">
            <Stack gap="related">
              <ResidentText as="p" className="terms-draft__title">
                {t("draftTitle")}
              </ResidentText>
              <ResidentText as="p">{t("draftBody")}</ResidentText>
              {/* Why it is not published is for staff, in English. */}
              <p lang="en" dir="ltr">
                {t("draftWhy")}
              </p>
              <ul className="terms-draft__reasons" lang="en" dir="ltr">
                {view.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </Stack>
          </div>
        )}

        <Stack gap="related">
          <div id="terms-title">
            <TermsBlock as="h1" text={document.title} marked />
          </div>
          <dl className="terms-facts" data-testid="terms-facts">
            <div className="terms-facts__item">
              <ResidentText as="dt">{t("version")}</ResidentText>
              <dd>
                <bdi dir="ltr" data-testid="terms-version">
                  {view.consentVersion ?? "-"}
                </bdi>
              </dd>
            </div>
            <div className="terms-facts__item">
              <ResidentText as="dt">{t("owner")}</ResidentText>
              <dd>
                <bdi data-testid="terms-owner">{view.owner ?? "-"}</bdi>
              </dd>
            </div>
            <div className="terms-facts__item">
              <ResidentText as="dt">{t("updated")}</ResidentText>
              <dd>
                <bdi dir="ltr" data-testid="terms-updated">
                  {view.lastUpdated ?? "-"}
                </bdi>
              </dd>
            </div>
            {deletedOn !== null && (
              <div className="terms-facts__item">
                <ResidentText as="dt">{t("dataDeleted")}</ResidentText>
                <dd>
                  <bdi dir="ltr" data-testid="terms-deleted">
                    {deletedOn}
                  </bdi>
                </dd>
              </div>
            )}
          </dl>
          {deletedOn !== null && (
            <ResidentText as="p" testId="terms-deleted-note">
              {t("dataDeletedNote")}
            </ResidentText>
          )}
          {showNote && (
            <ResidentText as="p" testId="terms-translation-note">
              {t("translationNote", { lang: languageOf(lang).native })}
            </ResidentText>
          )}
        </Stack>

        {document.sections.map((section) => (
          <Stack key={section.id} as="section" gap="related" testId={`terms-section-${section.id}`}>
            <TermsBlock as="h2" text={section.heading} marked />
            <Stack gap="paragraph">
              {section.lines.map((line, index) => (
                <TermsBlock key={index} as="p" className="terms-line" text={line} marked={!showNote} />
              ))}
              {section.id === "contact" && (
                <p className="terms-contact">
                  <strong>
                    <ResidentText>{t("privacyContact")}</ResidentText>
                  </strong>{" "}
                  <bdi dir="ltr" className="terms-contact__value" data-testid="terms-contact">
                    {view.privacyContact ?? "-"}
                  </bdi>
                </p>
              )}
            </Stack>
          </Stack>
        ))}
      </Stack>
      </div>
    </Screen>
  );
}
