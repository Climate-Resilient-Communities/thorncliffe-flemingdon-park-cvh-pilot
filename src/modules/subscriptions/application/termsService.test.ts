import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import realTerms from "../../../../data/catalogue/terms.json";
import { termsReviewHash, type TermsSource } from "../domain/terms";
import { bundledTermsInput } from "../adapters/bundledTerms";
import { currentConsentVersion, currentPublishedTerms, termsPageView } from "../index";
import { createTermsService, signupConsentVersion, termsPageMode } from "./termsService";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function service(change: Partial<TermsSource> = {}, reviewed = true, afterReview: (t: TermsSource) => void = () => {}) {
  const terms: TermsSource = {
    ...(JSON.parse(JSON.stringify(realTerms)) as TermsSource),
    owner: "Ana Reyes",
    privacyContact: "privacy@example.org",
    lastUpdated: "2026-10-02",
    counselWaiver: null,
    publishedVersions: null,
    ...change,
  };
  const hash = termsReviewHash(terms, sha);
  if (reviewed) {
    terms.englishReview = { reviewer: "Ana Reyes", date: "2026-10-03", sourceHash: hash };
    terms.counselReview = { reviewer: "Counsel Co.", date: "2026-10-04", version: terms.consentVersion, sourceHash: hash };
  }
  afterReview(terms);
  return createTermsService({ load: () => ({ terms, translations: {} }), hash: sha, today: () => "2026-12-01" });
}

describe("the terms seam for the page and the web sign-up", () => {
  it("returns the published consent_version and the text in the language asked for", () => {
    const terms = service();

    expect(terms.currentConsentVersion()).toBe("2026-10-02.1");
    const published = terms.currentPublishedTerms("ur");
    expect(published).toMatchObject({
      status: "published",
      consentVersion: "2026-10-02.1",
      lang: "ur",
      owner: "Ana Reyes",
      lastUpdated: "2026-10-02",
      privacyContact: "privacy@example.org",
    });
    // Nothing is translated yet: every text is English standing in, marked unavailable.
    expect(published!.document.title).toEqual({ text: "Terms and privacy", lang: "en", unavailable: true });
    expect(terms.currentPublishedTerms("en")!.document.title.unavailable).toBe(false);
  });

  it("returns null when nothing is published, so a sign-up has no version to record and must refuse", () => {
    const unreviewed = service({}, false);
    expect(unreviewed.currentPublishedTerms("en")).toBeNull();
    expect(unreviewed.currentConsentVersion()).toBeNull();
    const view = unreviewed.termsPageView("en");
    expect(view.status).toBe("draft");
    if (view.status === "draft") expect(view.reasons.length).toBeGreaterThan(0);

    expect(service({ privacyContact: "PLACEHOLDER: later" }).currentPublishedTerms("en")).toBeNull();
  });

  it("publishes the committed terms: the owner reviewed the English and waived counsel's review for the pilot", () => {
    expect(currentConsentVersion()).toBe("2026-10-02.1");
    expect(currentPublishedTerms("en")).toMatchObject({
      status: "published",
      consentVersion: "2026-10-02.1",
      owner: "Helena Yu, Sprout Climate Association",
      lastUpdated: "2026-10-06",
      privacyContact: "helena.yu@sprout-climate.org",
    });
    expect(termsPageView("en").status).toBe("published");
    expect(bundledTermsInput().terms.counselWaiver).toMatchObject({ decidedBy: "Helena Yu, Sprout Climate Association", version: "2026-10-02.1" });
  });

  it("names no new version until counsel has reviewed it, so an earlier version stays the one in force", () => {
    const first = service();
    const second = service({}, true, (t) => (t.consentVersion = "2026-11-01.1"));

    expect(first.currentConsentVersion()).toBe("2026-10-02.1");
    expect(second.currentPublishedTerms("en")).toBeNull(); // a new version is published only once counsel has reviewed it
  });
});

describe("what the page does with unpublished terms", () => {
  it("shows published terms everywhere", () => {
    for (const environment of ["production", "preview", "development"] as const) {
      expect(termsPageMode({ status: "published" }, environment)).toBe("published");
    }
  });

  it("hides a draft in production, so a resident never reads unreviewed legal text as final, and shows it marked elsewhere", () => {
    expect(termsPageMode({ status: "draft" }, "production")).toBe("hidden");
    expect(termsPageMode({ status: "draft" }, "preview")).toBe("draft");
    expect(termsPageMode({ status: "draft" }, "development")).toBe("draft");
  });
});

describe("the terms version a sign-up records (S07.02)", () => {
  it("is the published version everywhere, and the draft's outside production only; in production no sign-up is taken until the terms are published", () => {
    for (const environment of ["production", "preview", "development"] as const) {
      expect(signupConsentVersion({ status: "published", consentVersion: "2026-10-02.1" }, environment)).toBe("2026-10-02.1");
    }
    expect(signupConsentVersion({ status: "draft", consentVersion: "2026-10-02.1" }, "production")).toBeNull();
    expect(signupConsentVersion({ status: "draft", consentVersion: "2026-10-02.1" }, "preview")).toBe("2026-10-02.1");
    expect(signupConsentVersion({ status: "draft", consentVersion: "2026-10-02.1" }, "development")).toBe("2026-10-02.1");
    expect(signupConsentVersion({ status: "draft", consentVersion: null }, "preview")).toBeNull();
  });

  it("is null for a draft whose version is not written YYYY-MM-DD.n, so a preview's sign-up page is a 404, not a form that answers 503", () => {
    for (const environment of ["preview", "development"] as const) {
      for (const version of ["v1", "2026-10-02", "2026-10-02.0", "", " 2026-10-02.1"]) {
        expect(signupConsentVersion({ status: "draft", consentVersion: version }, environment), version).toBeNull();
      }
    }
  });
});
