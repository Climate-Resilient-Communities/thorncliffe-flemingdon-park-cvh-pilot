// The terms seam (S07.01). The page at /{lang}/terms and the web sign-up (S07.02) both read the terms here:
//
//   currentPublishedTerms(lang)  the published consent_version and text in a language, or null when nothing is
//                                published. A sign-up that gets null must refuse: it has no version to record.
//   currentConsentVersion()      the published version alone, or null.
//   termsPageView(lang)          what the page shows: the published text, or the draft with the reasons it is not
//                                published (the page decides whether a draft may be shown, see termsPageMode).
//
// A sign-up records the version it showed (`subscriber.consent_version`); a new version applies to new sign-ups
// only (versionToRecord in domain/terms.ts).
import type { LangCode } from "@/contracts/lang";
import type { Hasher } from "@/contracts/contentReview";
import { planTerms, type TermsDocument, type TermsInput, type TermsPlan } from "../domain/terms";

export interface TermsServiceDeps {
  /** The committed files (data/catalogue/terms.json and the translations), already read. */
  load: () => TermsInput;
  hash: Hasher;
  /** Today as YYYY-MM-DD. */
  today: () => string;
}

export interface PublishedTerms {
  status: "published";
  consentVersion: string;
  /** The language asked for; individual texts may still be English (TermsText.unavailable). */
  lang: LangCode;
  document: TermsDocument;
  owner: string;
  lastUpdated: string;
  privacyContact: string;
}

export interface DraftTerms {
  status: "draft";
  /** Why the terms are not published. */
  reasons: string[];
  consentVersion: string | null;
  lang: LangCode;
  document: TermsDocument;
  owner: string | null;
  lastUpdated: string | null;
  privacyContact: string | null;
}

export type TermsView = PublishedTerms | DraftTerms;

/** What the page does with terms that are not published: show the draft marked as such, or not at all. */
export type TermsPageMode = "published" | "draft" | "hidden";

/**
 * The safe choice for residents (decision recorded in S07.01): in production, terms that are not published are
 * not shown at all (the page is a 404), because a resident could mistake unreviewed legal text for the final
 * terms; in previews and development the draft is shown with a "draft - not yet published" banner so staff can
 * check the wording and the layout.
 */
export function termsPageMode(view: Pick<TermsView, "status">, environment: "production" | "preview" | "development"): TermsPageMode {
  if (view.status === "published") return "published";
  return environment === "production" ? "hidden" : "draft";
}

/**
 * The terms version a sign-up may record (S07.02), by the same rule as the page (termsPageMode): published terms everywhere; in a preview or
 * in development, the draft's version too, so staff can try the sign-up against the text the page shows under its draft banner (those
 * environments send no text: SMS_MODE is `log`). Null in production while the terms are not published, so no sign-up is taken there.
 */
export function signupConsentVersion(view: Pick<TermsView, "status" | "consentVersion">, environment: "production" | "preview" | "development"): string | null {
  if (view.status === "published") return view.consentVersion;
  return environment === "production" ? null : view.consentVersion;
}

export function createTermsService(deps: TermsServiceDeps) {
  const plan = (): TermsPlan => planTerms(deps.load(), { hash: deps.hash, today: deps.today() });

  function termsPageView(lang: LangCode): TermsView {
    const p = plan();
    if (p.published) {
      return {
        status: "published",
        consentVersion: p.consentVersion as string,
        lang,
        document: p.documents[lang],
        owner: p.owner as string,
        lastUpdated: p.lastUpdated as string,
        privacyContact: p.privacyContact as string,
      };
    }
    return {
      status: "draft",
      reasons: p.reasons,
      consentVersion: p.consentVersion,
      lang,
      document: p.documents[lang],
      owner: p.owner,
      lastUpdated: p.lastUpdated,
      privacyContact: p.privacyContact,
    };
  }

  function currentPublishedTerms(lang: LangCode): PublishedTerms | null {
    const view = termsPageView(lang);
    return view.status === "published" ? view : null;
  }

  function currentConsentVersion(): string | null {
    return currentPublishedTerms("en")?.consentVersion ?? null;
  }

  return { plan, termsPageView, currentPublishedTerms, currentConsentVersion };
}

export type TermsService = ReturnType<typeof createTermsService>;
