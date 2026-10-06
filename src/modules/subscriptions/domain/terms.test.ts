import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import realTerms from "../../../../data/catalogue/terms.json";
import { TRANSLATED_LANGS } from "@/contracts/contentReview";
import type { LangCode } from "@/contracts/lang";
import {
  CONSENT_VERSION_FORMAT,
  NEW_VERSION_APPLIES_TO,
  REQUIRED_FACTS,
  REQUIRED_SECTIONS,
  REQUIRED_TOKENS,
  formatTermsReport,
  planTerms,
  termsHeadingKey,
  termsLineKey,
  termsReviewHash,
  termsTexts,
  termsTitleKey,
  versionToRecord,
  type TermsInput,
  type TermsSource,
} from "./terms";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const TODAY = "2026-12-01";
const options = { hash: sha, today: TODAY };

/** The committed English, named, reviewed by its owner and by counsel: the state S07.01 publishes in. */
function approved(change: Partial<TermsSource> = {}): TermsSource {
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
  if (!("englishReview" in change)) terms.englishReview = { reviewer: "Ana Reyes", date: "2026-10-03", sourceHash: hash };
  if (!("counselReview" in change)) {
    terms.counselReview = { reviewer: "Counsel Co.", date: "2026-10-04", version: terms.consentVersion, sourceHash: hash };
  }
  return terms;
}

const input = (terms: TermsSource, translations: TermsInput["translations"] = {}): TermsInput => ({ terms, translations });
const plan = (terms: TermsSource, translations: TermsInput["translations"] = {}) => planTerms(input(terms, translations), options);
const reasons = (terms: TermsSource) => plan(terms).reasons;
/** Applies an edit to the English after both reviews were recorded. */
function editedAfterReview(edit: (t: TermsSource) => void): TermsSource {
  const terms = approved();
  edit(terms);
  return terms;
}

/** The same terms, published without counsel's review under the owner's recorded waiver (the pilot). */
function waived(change: Partial<TermsSource> = {}): TermsSource {
  const terms = approved({ counselReview: null, ...change });
  if (!("counselWaiver" in change)) {
    terms.counselWaiver = { decidedBy: "Ana Reyes", date: "2026-10-04", reason: "Pilot: counsel review before the MVP.", version: terms.consentVersion, sourceHash: termsReviewHash(terms, sha) };
  }
  return terms;
}

describe("publishing the terms without counsel's review, under the owner's waiver", () => {
  it("publishes when the owner waived counsel's review of exactly this version and text", () => {
    expect(plan(waived()).reasons).toEqual([]);
    expect(plan(waived()).published).toBe(true);
  });

  it("lapses like a review: a changed word, contact or version needs a new decision", () => {
    const edited = waived();
    edited.sections![0].lines![0] = "We keep five things.";
    expect(reasons(edited)).toContain("counsel waiver: the terms changed since it was decided, so a new decision is needed");
    const contact = waived();
    contact.privacyContact = "someone@example.org";
    expect(reasons(contact)).toContain("counsel waiver: the terms changed since it was decided, so a new decision is needed");
    const bumped = waived();
    bumped.consentVersion = "2026-10-09.1";
    bumped.lastUpdated = "2026-10-09";
    expect(reasons(bumped)).toContain("counsel waiver: covers version 2026-10-02.1, not 2026-10-09.1");
  });

  it("is decided by the owner, dated, and gives a reason", () => {
    const by = (decidedBy: string) => waived({ counselWaiver: { ...waived().counselWaiver, decidedBy } });
    expect(reasons(by("Someone Else"))).toContain("counsel waiver: not decided by the owner");
    expect(reasons(by("PLACEHOLDER: later"))).toContain("counsel waiver: nobody is named as deciding it");
    expect(reasons(waived({ counselWaiver: { ...waived().counselWaiver, reason: "" } }))).toContain("counsel waiver: no reason is recorded");
    expect(reasons(waived({ counselWaiver: { ...waived().counselWaiver, date: "2026-12-02" } }))).toContain("counsel waiver: dated in the future");
    expect(reasons(waived({ counselWaiver: { ...waived().counselWaiver, date: "2026-10-01" } }))).toContain(
      "counsel waiver: dated before the last update, so a new decision is needed",
    );
    expect(reasons(waived({ counselWaiver: { ...waived().counselWaiver, sourceHash: null } }))).toContain(
      "counsel waiver: records no source hash (the text it covers)",
    );
  });

  it("does not stand in for a counsel review that is recorded: the review's rules apply", () => {
    const both = waived();
    both.counselReview = { reviewer: "Counsel Co.", date: "2026-10-04", version: "2026-09-01.1", sourceHash: termsReviewHash(both, sha) };
    expect(reasons(both)).toContain("counsel review: covers version 2026-09-01.1, not 2026-10-02.1");
  });

  it("treats an unfilled placeholder counsel review as none recorded", () => {
    const placeholder = waived({ counselReview: { reviewer: "PLACEHOLDER: counsel to be named", date: null, version: null, sourceHash: null } });
    expect(plan(placeholder).published).toBe(true);
    const noWaiver = approved({ counselReview: { reviewer: "PLACEHOLDER: counsel to be named", date: null, version: null, sourceHash: null } });
    expect(reasons(noWaiver)).toContain("counsel review: none is recorded");
  });
});

describe("publishing the terms", () => {
  it("publishes when the owner, the English review, the privacy contact, the version and counsel's review are in order", () => {
    const result = plan(approved());

    expect(result.reasons).toEqual([]);
    expect(result.published).toBe(true);
    expect(result.consentVersion).toBe("2026-10-02.1");
    expect(result.owner).toBe("Ana Reyes");
    expect(result.lastUpdated).toBe("2026-10-02");
    expect(result.privacyContact).toBe("privacy@example.org");
    expect(formatTermsReport(result)[0]).toBe("Terms 2026-10-02.1 published");
  });

  it("is published as committed: owner and privacy contact named, the English reviewed by the owner, counsel's review waived for the pilot", () => {
    const result = plan(realTerms as unknown as TermsSource);

    expect(result.reasons).toEqual([]);
    expect(result.published).toBe(true);
    expect(result.owner).toBe("Helena Yu, Sprout Climate Association");
    expect(result.privacyContact).toBe("helena.yu@sprout-climate.org");
    expect(formatTermsReport(result)[0]).toBe("Terms 2026-10-02.1 published");
  });

  it("refuses a missing or placeholder owner, privacy contact and English review", () => {
    expect(reasons(approved({ owner: "PLACEHOLDER: later" }))).toContain("the owner is still a placeholder");
    expect(reasons(approved({ owner: null }))).toContain("no owner is named");
    expect(reasons(approved({ privacyContact: "PLACEHOLDER: later" }))).toContain("the privacy contact is still a placeholder");
    expect(reasons(approved({ privacyContact: "  " }))).toContain("no privacy contact is named");
    expect(reasons(approved({ englishReview: null }))).toContain("no English review is recorded");
    expect(reasons(approved({ lastUpdated: "2999-01-01" }))).toContain("the last-updated date is in the future");
  });

  it("refuses an English review by someone other than the owner, or of other English", () => {
    const base = approved();
    expect(reasons({ ...base, englishReview: { ...base.englishReview, reviewer: "Sam Lee" } })).toContain(
      "the English review was not completed by the owner",
    );
    expect(reasons(editedAfterReview((t) => (t.title = "Terms")))).toContain("the English changed since the owner reviewed it");
  });

  it("checks the consent_version format", () => {
    for (const version of ["1", "v2", "2026-10-02", "2026-10-02.0", "2026-10-02.1.2"]) {
      expect(CONSENT_VERSION_FORMAT.test(version), version).toBe(false);
    }
    expect(CONSENT_VERSION_FORMAT.test("2026-10-02.1")).toBe(true);
    expect(CONSENT_VERSION_FORMAT.test("2026-11-15.12")).toBe(true);
    expect(reasons(approved({ consentVersion: "v2" }))).toContain("the consent_version is not written YYYY-MM-DD.n");
    expect(reasons(approved({ consentVersion: null }))).toContain("no consent_version");
  });

  it("will not publish when an edit drops something the acceptance criteria require", () => {
    const without = (id: string, pattern: RegExp) => {
      const terms = approved();
      const section = terms.sections!.find((s) => s.id === id)!;
      section.lines = section.lines!.filter((line) => !pattern.test(line ?? ""));
      return terms;
    };

    expect(reasons(without("messages", /overnight/))).toContain("the English no longer says that a message may not be sent overnight");
    expect(reasons(without("who", /Cohere/))).toContain("the English no longer says Cohere as a processor");
    expect(reasons(without("age", /16/))).toContain("the English no longer says the minimum age of 16");
    expect(reasons(without("stop", /Reply STOP/))).toContain("the English no longer says how to stop with STOP");
    expect(reasons(without("keep", /do not ask for your name/))).toEqual(
      expect.arrayContaining([
        "the English no longer says that no name is kept",
        "the English no longer says that no unit number, email or password is kept",
      ]),
    );
    const missingSection = approved();
    missingSection.sections = missingSection.sections!.filter((s) => s.id !== "owns");
    expect(reasons(missingSection)).toContain('the "owns" section is missing');
    const placeholderInText = approved();
    placeholderInText.sections![0].lines![0] = "PLACEHOLDER: write this";
    expect(reasons(placeholderInText)).toContain("the English text still holds a placeholder");
  });

  it("states every fact of the acceptance criteria in the committed English", () => {
    const english = Object.values(termsTexts(realTerms as unknown as TermsSource)).join(" ");

    for (const { fact, pattern } of REQUIRED_FACTS) expect(pattern.test(english), fact).toBe(true);
    expect((realTerms.sections as { id: string }[]).map((s) => s.id)).toEqual([...REQUIRED_SECTIONS]);
    // The processors, the regions the docs give, and the exact way to stop.
    expect(english).toContain("Its servers are in Montreal");
    expect(english).toContain("The database is in Canada");
    expect(english).toContain("Reply STOP to any text from the Hub. Or reply 0, then reply 0 again to confirm.");
  });
});

describe("the counsel review gate", () => {
  it("does not publish without a counsel review", () => {
    for (const counselReview of [null, {}, { reviewer: null, date: null, version: null, sourceHash: null }]) {
      const result = plan(approved({ counselReview }));
      expect(result.published).toBe(false);
      expect(result.reasons).toEqual(["counsel review: none is recorded"]);
    }
  });

  it("stops publishing a version whose text changed after counsel's review, until a new review is recorded", () => {
    const published = approved();
    expect(plan(published).published).toBe(true);

    const changed = editedAfterReview((t) => (t.sections![4].lines![0] = "You must be 18 or older to sign up."));
    // The owner re-reviews their English but counsel has not yet seen the new text.
    changed.englishReview = { reviewer: "Ana Reyes", date: "2026-10-05", sourceHash: termsReviewHash(changed, sha) };
    changed.lastUpdated = "2026-10-05";
    const refused = plan(changed);
    expect(refused.published).toBe(false);
    expect(refused.reasons).toContain("counsel review: dated before the last update, so a new review is needed");
    expect(refused.reasons).toContain("counsel review: the terms changed since counsel reviewed them, so a new review is needed");

    // Even with the last-updated date left alone, the hash alone stops it.
    const sameDate = editedAfterReview((t) => (t.sections![4].lines![0] = "You must be 18 or older to sign up."));
    sameDate.englishReview = { reviewer: "Ana Reyes", date: "2026-10-03", sourceHash: termsReviewHash(sameDate, sha) };
    expect(plan(sameDate).reasons).toEqual(["counsel review: the terms changed since counsel reviewed them, so a new review is needed"]);

    // Recording a new review of the new text publishes it again.
    changed.counselReview = { reviewer: "Counsel Co.", date: "2026-10-06", version: changed.consentVersion, sourceHash: termsReviewHash(changed, sha) };
    expect(plan(changed).reasons).toEqual([]);
  });

  it("stops publishing when only the privacy contact changed after the review", () => {
    const changed = editedAfterReview((t) => (t.privacyContact = "other@example.org"));

    expect(plan(changed).published).toBe(false);
    expect(plan(changed).reasons).toContain("counsel review: the terms changed since counsel reviewed them, so a new review is needed");
  });

  it("stops publishing a new version that counsel did not review", () => {
    const bumped = editedAfterReview((t) => {
      t.consentVersion = "2026-10-09.1";
      t.lastUpdated = "2026-10-09";
    });
    bumped.englishReview = { reviewer: "Ana Reyes", date: "2026-10-09", sourceHash: termsReviewHash(bumped, sha) };
    bumped.counselReview = { ...bumped.counselReview!, date: "2026-10-09" };

    // The review covered 2026-10-02.1; only the version changed, so the hash alone still matches.
    expect(plan(bumped).reasons).toEqual(["counsel review: covers version 2026-10-02.1, not 2026-10-09.1"]);
  });

  it("refuses a consent version reused for changed text, until the version is bumped (the ledger of signed versions)", () => {
    const signed = approved();
    signed.publishedVersions = { "2026-10-02.1": termsReviewHash(signed, sha) };
    expect(plan(signed).reasons).toEqual([]);

    // The reviewer's case: the age line changes and both reviews are re-recorded under the same version.
    const reused = approved({ publishedVersions: signed.publishedVersions });
    reused.sections![4].lines![0] = "You must be 18 or older to sign up.";
    const hash = termsReviewHash(reused, sha);
    reused.englishReview = { reviewer: "Ana Reyes", date: "2026-10-03", sourceHash: hash };
    reused.counselReview = { reviewer: "Counsel Co.", date: "2026-10-04", version: "2026-10-02.1", sourceHash: hash };
    expect(plan(reused).published).toBe(false);
    expect(plan(reused).reasons).toEqual(["consent_version 2026-10-02.1 was already published with different text: bump consentVersion"]);

    // Bumping the version (and the date it carries) lets the new text through, and the ledger keeps the old version.
    reused.consentVersion = "2026-10-09.1";
    reused.lastUpdated = "2026-10-09";
    const bumpedHash = termsReviewHash(reused, sha);
    reused.englishReview = { reviewer: "Ana Reyes", date: "2026-10-09", sourceHash: bumpedHash };
    reused.counselReview = { reviewer: "Counsel Co.", date: "2026-10-09", version: "2026-10-09.1", sourceHash: bumpedHash };
    reused.publishedVersions = { ...signed.publishedVersions, "2026-10-09.1": bumpedHash };
    expect(plan(reused).reasons).toEqual([]);
  });

  it("accepts a version that is not in the ledger yet, or whose ledger entry is the current text", () => {
    expect(reasons(approved({ publishedVersions: {} }))).toEqual([]);
    expect(reasons(approved({ publishedVersions: { "2026-09-01.1": "an older text" } }))).toEqual([]);
  });

  it("keeps the required tokens in the one JSON the Python review script also reads", () => {
    expect(REQUIRED_TOKENS).toEqual(["STOP", "0", "16", "Twilio", "Cohere", "Vercel", "Supabase"]);
  });

  it("refuses a last-updated date earlier than the date of the consent version", () => {
    const terms = approved({ consentVersion: "2026-10-09.1", lastUpdated: "2026-10-02" });
    expect(reasons(terms)).toContain("the last-updated date (2026-10-02) is before the date of consent_version 2026-10-09.1");
    expect(reasons(approved({ consentVersion: "2026-10-02.2" }))).not.toContain(
      expect.stringContaining("before the date of consent_version"),
    );
  });

  it("refuses an unnamed, undated, future-dated or hash-less counsel review", () => {
    const base = approved();
    const counsel = base.counselReview!;
    expect(reasons({ ...base, counselReview: { ...counsel, reviewer: "PLACEHOLDER: counsel" } })).toContain("counsel review: no named reviewer");
    expect(reasons({ ...base, counselReview: { ...counsel, date: null } })).toContain("counsel review: no valid date");
    expect(reasons({ ...base, counselReview: { ...counsel, date: "2999-01-01" } })).toContain("counsel review: dated in the future");
    expect(reasons({ ...base, counselReview: { ...counsel, sourceHash: null } })).toContain(
      "counsel review: records no source hash (the text it reviewed)",
    );
  });
});

describe("versions apply to new sign-ups only", () => {
  it("records the version shown to a new sign-up, and leaves an existing subscriber's version alone", () => {
    expect(NEW_VERSION_APPLIES_TO).toBe("new_signups_only");
    expect(versionToRecord(null, "2026-10-09.1")).toBe("2026-10-09.1");
    expect(versionToRecord(undefined, "2026-10-09.1")).toBe("2026-10-09.1");
    expect(versionToRecord("", "2026-10-09.1")).toBe("2026-10-09.1");
    expect(versionToRecord("2026-10-02.1", "2026-10-09.1")).toBe("2026-10-02.1");
  });
});

// ---------------------------------------------------------------- translations
const record = (key: string, english: string, text: string, change: Record<string, unknown> = {}) => ({
  source: english,
  sourceHash: sha(english),
  text,
  model: "stub",
  status: "reviewed" as const,
  reviewer: "Wei Chen",
  reviewedOn: "2026-11-02",
  translatedOn: "2026-11-01",
  ...change,
});

function translationsOf(lang: Exclude<LangCode, "en">, terms: TermsSource, make: (key: string, english: string) => Record<string, unknown> | null) {
  const texts = Object.fromEntries(Object.entries(termsTexts(terms)).map(([key, english]) => [key, make(key, english)]));
  return { [lang]: { language: lang, texts } } as TermsInput["translations"];
}

describe("translations", () => {
  const terms = approved();
  const english = termsTexts(terms);

  it("show English with translation.unavailable where nothing is translated, in every language", () => {
    const result = plan(terms);

    for (const lang of TRANSLATED_LANGS) {
      const document = result.documents[lang];
      const all = [document.title, ...document.sections.flatMap((s) => [s.heading, ...s.lines])];
      expect(all.length).toBe(Object.keys(english).length);
      expect(all.every((t) => t.unavailable && t.lang === "en" && t.text.length > 0)).toBe(true);
    }
    expect(result.documents.en.title).toEqual({ text: "Terms and privacy", lang: "en", unavailable: false });
    expect(result.report.loaded).toBe(0);
    expect(result.report.unavailable).toHaveLength(Object.keys(english).length * TRANSLATED_LANGS.length);
    expect(formatTermsReport(result).join("\n")).toContain("shown in English with translation.unavailable");
  });

  it("load a reviewed, current translation in its own language", () => {
    const ur = translationsOf("ur", terms, (key, en) => record(key, en, `اردو ${en.replace(/[^\d\s]/g, "")} STOP 0 16 Twilio Cohere Vercel Supabase`));
    const result = plan(terms, ur);

    expect(result.documents.ur.title).toMatchObject({ lang: "ur", unavailable: false });
    expect(result.documents.ur.sections[0].heading.lang).toBe("ur");
    expect(result.report.unavailable.filter((u) => u.lang === "ur")).toEqual([]);
    expect(result.documents.es.title.unavailable).toBe(true);
  });

  it("do not load when machine-only, stale, unreviewed or missing what a resident acts on", () => {
    const tamper = (change: Record<string, unknown>, only?: string) =>
      plan(terms, translationsOf("es", terms, (key, en) => record(key, en, `${en} STOP 0 16 Twilio Cohere Vercel Supabase`, key === (only ?? key) ? change : {})));

    expect(tamper({ status: "machine", reviewer: null, reviewedOn: null }).documents.es.title.unavailable).toBe(true);
    expect(tamper({ sourceHash: sha("an older English") }).documents.es.title.unavailable).toBe(true);
    expect(tamper({ reviewer: "PLACEHOLDER: later" }).documents.es.title.unavailable).toBe(true);
    expect(tamper({ reviewedOn: "later" }).documents.es.title.unavailable).toBe(true);
    const lost = plan(terms, translationsOf("es", terms, (key, en) => record(key, en, en.replace("STOP", "PARAR"))));
    const stopLine = lost.documents.es.sections.find((s) => s.id === "stop")!.lines[0];
    expect(stopLine.unavailable).toBe(true);
    expect(lost.report.unavailable.find((u) => u.lang === "es" && u.key === termsLineKey("stop", 0))).toMatchObject({ lang: "es", reason: "lost_required" });
    expect(lost.documents.es.title.unavailable).toBe(false); // nothing to lose in the title
  });

  it("go stale when the English changes, without anyone touching the translation", () => {
    const es = translationsOf("es", terms, (key, en) => record(key, en, `${en} STOP 0 16 Twilio Cohere Vercel Supabase`));
    expect(plan(terms, es).documents.es.title.unavailable).toBe(false);

    const changed = approved();
    changed.title = "Terms and your privacy";
    expect(plan(changed, es).documents.es.title).toMatchObject({ unavailable: true, lang: "en", text: "Terms and your privacy" });
    expect(plan(changed, es).report.unavailable.find((u) => u.lang === "es")).toEqual({ key: termsTitleKey, lang: "es", reason: "stale" });
  });

  it("zh-Hant loads only while it follows a current, reviewed zh", () => {
    const zh = translationsOf("zh", terms, (key, en) => record(key, en, `中 ${en}`));
    const hant = (zhText: (key: string) => string) =>
      translationsOf("zh-Hant", terms, (key, en) =>
        record(key, en, `中 ${en}`, {
          model: "opencc",
          conversion: { from: "zh", fromTextHash: sha(zhText(key)), openccVersion: "1.0", config: "cn2t" },
        }),
      );

    const ok = plan(terms, { ...zh, ...hant((key) => `中 ${english[key]}`) });
    expect(ok.documents["zh-Hant"].title.unavailable).toBe(false);
    const drifted = plan(terms, { ...zh, ...hant(() => "something else") });
    expect(drifted.documents["zh-Hant"].title.unavailable).toBe(true);
    expect(plan(terms, hant((key) => `中 ${english[key]}`)).documents["zh-Hant"].title.unavailable).toBe(true);
  });

  it("are built even while the terms are a draft, so the draft view shows the page as residents would see it", () => {
    const draft = plan({ ...(realTerms as unknown as TermsSource), owner: "PLACEHOLDER: later" });

    expect(draft.published).toBe(false);
    expect(draft.documents.en.sections.map((s) => s.id)).toEqual([...REQUIRED_SECTIONS]);
    expect(draft.documents.ur.sections.length).toBe(REQUIRED_SECTIONS.length);
  });
});

// ---------------------------------------------------------------- plain words
const words = (text: string) => text.match(/[A-Za-z]+(?:'[a-z]+)?/g) ?? [];
function syllables(word: string): number {
  const w = word.toLowerCase().replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  return Math.max(1, w.match(/[aeiouy]{1,2}/g)?.length ?? 1);
}

describe("the committed English is written in plain words", () => {
  const lines = [
    ...Object.entries(termsTexts(realTerms as unknown as TermsSource))
      .filter(([key]) => !key.endsWith(".heading") && key !== termsTitleKey)
      .map(([, text]) => text),
  ];
  const sentences = lines.flatMap((line) => line.split(/(?<=[.?!])\s+/)).filter((s) => words(s).length > 0);

  it("uses short sentences", () => {
    const lengths = sentences.map((s) => words(s).length);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(24);
    expect(lengths.reduce((a, b) => a + b, 0) / lengths.length).toBeLessThanOrEqual(12);
  });

  it("reads at about grade 6 or below (Flesch-Kincaid)", () => {
    const all = sentences.flatMap(words);
    const grade = 0.39 * (all.length / sentences.length) + 11.8 * (all.reduce((n, w) => n + syllables(w), 0) / all.length) - 15.59;
    expect(grade).toBeLessThanOrEqual(6.5);
  });

  it("keeps headings short", () => {
    for (const [key, text] of Object.entries(termsTexts(realTerms as unknown as TermsSource))) {
      if (key.endsWith(".heading")) expect(words(text).length, text).toBeLessThanOrEqual(6);
    }
    expect(termsHeadingKey("keep")).toBe("terms.keep.heading");
  });
});
