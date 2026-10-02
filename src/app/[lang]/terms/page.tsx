import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { FALLBACK_MARKER, ResidentText, Screen, Stack } from "@/ui";
import { isLaunchCode, languageOf } from "@/i18n/languages";
import { failClosedEnvironment } from "@/platform/config/env";
import { termsPageMode, termsPageView, type TermsText } from "@/modules/subscriptions";
import "./terms.css";

// Prerendered at build time for every launch language (the layout's generateStaticParams) from the committed files.
// The page reads no cookie and no header, and needs no database.

/** One text of the terms: a translation as is, English standing in for a missing one marked and isolated (bidi). */
function TermsLine({ text }: { text: TermsText }) {
  return <ResidentText>{text.unavailable ? FALLBACK_MARKER + text.text : text.text}</ResidentText>;
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
 * the URL. Terms that are not published (a placeholder, no counsel review, or a change after it) are never shown as
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
  const { document } = view;
  const someInEnglish = [document.title, ...document.sections.flatMap((s) => [s.heading, ...s.lines])].some((x) => x.unavailable);

  return (
    <Screen surface="resident" testId="terms">
      <Stack gap="stack">
        {view.status === "draft" && (
          <div className="terms-draft" role="note" data-testid="terms-draft">
            <Stack gap="related">
              <p>
                <strong>
                  <ResidentText>{t("draftTitle")}</ResidentText>
                </strong>
              </p>
              <p>
                <ResidentText>{t("draftBody")}</ResidentText>
              </p>
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
          <h1>
            <TermsLine text={document.title} />
          </h1>
          <dl className="terms-facts" data-testid="terms-facts">
            <div className="terms-facts__item">
              <dt>
                <ResidentText>{t("version")}</ResidentText>
              </dt>
              <dd>
                <bdi dir="ltr" data-testid="terms-version">
                  {view.consentVersion ?? "-"}
                </bdi>
              </dd>
            </div>
            <div className="terms-facts__item">
              <dt>
                <ResidentText>{t("owner")}</ResidentText>
              </dt>
              <dd>
                <bdi data-testid="terms-owner">{view.owner ?? "-"}</bdi>
              </dd>
            </div>
            <div className="terms-facts__item">
              <dt>
                <ResidentText>{t("updated")}</ResidentText>
              </dt>
              <dd>
                <bdi dir="ltr" data-testid="terms-updated">
                  {view.lastUpdated ?? "-"}
                </bdi>
              </dd>
            </div>
          </dl>
          {someInEnglish && lang !== "en" && (
            <p data-testid="terms-translation-note">
              <ResidentText>{t("translationNote", { lang: languageOf(lang).native })}</ResidentText>
            </p>
          )}
        </Stack>

        {document.sections.map((section) => (
          <Stack key={section.id} as="section" gap="related" testId={`terms-section-${section.id}`}>
            <h2>
              <TermsLine text={section.heading} />
            </h2>
            <Stack gap="paragraph">
              {section.lines.map((line, index) => (
                <p key={index} className="terms-line">
                  <TermsLine text={line} />
                </p>
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
    </Screen>
  );
}
