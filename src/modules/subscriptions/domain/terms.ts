// The terms and privacy text (S07.01): what may be published from data/catalogue/terms.json and
// data/catalogue/translations/content/<lang>.json (keys terms.*). Pure: it reads nothing and writes nothing.
//
// The consent module is `subscriptions` (spine AD-9 and the privacy rule: `subscriber.consent_version` is the
// terms version accepted), so the terms are owned here.
//
// Rules (story S07.01), on top of the S02.09 content rules in src/contracts/contentReview.ts:
//  - the English needs a named owner, a last-updated date and an English review by that owner tied to the
//    English it reviewed (a hash of the texts and the privacy contact), a privacy contact that is not a
//    placeholder, and a consent version;
//  - every fact the acceptance criteria list must still be in the English (REQUIRED_FACTS), so an edit cannot
//    quietly drop one;
//  - COUNSEL GATE: the text is published only while the counsel review recorded in the file covers exactly this
//    version and exactly this English and contact (same hash) and is not older than the last update. Changing a
//    word, the contact or the version after the review therefore stops publication until a new review is recorded;
//  - a translation is loaded only when reviewed and current (stale after any English change); any other text shows
//    in English with translation.unavailable (never blank, never machine-only);
//  - a text that is not published is never shown to residents as final (TermsPlan.published false).
//
// VERSIONING: a new version applies to new sign-ups only (see versionToRecord). An existing subscriber keeps the
// version they accepted until the end-of-pilot re-consent (E09).
import type { LangCode } from "@/contracts/lang";
import {
  TRANSLATED_LANGS,
  checkAttribution,
  englishReviewHash,
  evaluateTranslation,
  isIsoDate,
  isPlaceholder,
  present,
  type Hasher,
  type ReviewSource,
  type TranslationFile,
  type UnavailableReason,
} from "@/contracts/contentReview";

// ---------------------------------------------------------------- file shapes (all fields may be missing)
export interface CounselReview extends ReviewSource {
  /** The consent_version the counsel reviewed. */
  version?: string | null;
}

export interface TermsSectionSource {
  id?: string | null;
  heading?: string | null;
  lines?: (string | null)[] | null;
}

export interface TermsSource {
  consentVersion?: string | null;
  owner?: string | null;
  lastUpdated?: string | null;
  englishReview?: ReviewSource | null;
  counselReview?: CounselReview | null;
  privacyContact?: string | null;
  title?: string | null;
  sections?: TermsSectionSource[] | null;
}

export interface TermsInput {
  terms: TermsSource;
  translations: Partial<Record<LangCode, TranslationFile>>;
}

export interface TermsPlanOptions {
  hash: Hasher;
  /** Today as YYYY-MM-DD; no date in the file may be later. */
  today: string;
}

// ---------------------------------------------------------------- rules in code
/** The sections the page must have, in order (acceptance criteria of S07.01). */
export const REQUIRED_SECTIONS = ["keep", "who", "owns", "stop", "age", "messages", "contact"] as const;

/**
 * What the English must still say, whatever else changes: the data kept, the four processors, the way to stop,
 * the minimum age, the privacy contact and the overnight note. Checked on the English text as a whole.
 */
export const REQUIRED_FACTS: readonly { fact: string; pattern: RegExp }[] = [
  { fact: "the phone number is kept", pattern: /phone number/i },
  { fact: "the language is kept", pattern: /language/i },
  { fact: "the neighbourhood is kept", pattern: /neighbourhood/i },
  { fact: "that no name is kept", pattern: /do not ask for your name/i },
  { fact: "that no unit number, email or password is kept", pattern: /do not ask for your unit number, your email or a password/i },
  { fact: "that those are not kept", pattern: /do not keep them/i },
  { fact: "Twilio as a processor", pattern: /\bTwilio\b/ },
  { fact: "Cohere as a processor", pattern: /\bCohere\b/ },
  { fact: "Vercel as a processor", pattern: /\bVercel\b/ },
  { fact: "Supabase as a processor", pattern: /\bSupabase\b/ },
  { fact: "that the community owns the data", pattern: /community owns the data/i },
  { fact: "how to stop with STOP", pattern: /\bSTOP\b/ },
  { fact: "how to stop with 0", pattern: /reply 0\b/i },
  { fact: "that stopping deletes the subscription", pattern: /delete your subscription/i },
  { fact: "the minimum age of 16", pattern: /\b16\b/ },
  { fact: "that a parent or guardian can help", pattern: /parent or guardian/i },
  { fact: "the privacy contact", pattern: /privacy contact/i },
  { fact: "that Hub staff check messages", pattern: /Hub staff check/i },
  { fact: "that a message may not be sent overnight", pattern: /overnight/i },
];

/** Strings a translation must keep where the English has them: they are what a resident acts on or can check. */
export const REQUIRED_TOKENS = ["STOP", "0", "16", "Twilio", "Cohere", "Vercel", "Supabase"] as const;

/** `YYYY-MM-DD.n`: the date the text was settled and a counter for that day. */
export const CONSENT_VERSION_FORMAT = /^\d{4}-\d{2}-\d{2}\.[1-9]\d*$/;

/** Who a new version applies to (story S07.01): new sign-ups only. */
export const NEW_VERSION_APPLIES_TO = "new_signups_only" as const;

/**
 * The consent_version to record on a subscriber. A new sign-up records the version it was shown (the current
 * published one); an existing subscriber keeps the version they accepted until the end-of-pilot re-consent (E09),
 * so publishing a new version never rewrites anyone's record.
 */
export function versionToRecord(existing: string | null | undefined, shown: string): string {
  return present(existing) ? existing : shown;
}

// ---------------------------------------------------------------- text keys
const KEY_PREFIX = "terms";
export const PRIVACY_CONTACT_KEY = `${KEY_PREFIX}.privacyContact`;

export const termsTitleKey = `${KEY_PREFIX}.title`;
export const termsHeadingKey = (sectionId: string) => `${KEY_PREFIX}.${sectionId}.heading`;
export const termsLineKey = (sectionId: string, index: number) => `${KEY_PREFIX}.${sectionId}.${index}`;

/** Every translatable English text with its translation-file key, in file order (scripts/content_catalogue.py builds the same). */
export function termsTexts(terms: TermsSource): Record<string, string> {
  const texts: Record<string, string> = {};
  if (present(terms.title)) texts[termsTitleKey] = terms.title;
  for (const section of terms.sections ?? []) {
    if (!present(section.id)) continue;
    if (present(section.heading)) texts[termsHeadingKey(section.id)] = section.heading;
    (section.lines ?? []).forEach((line, index) => {
      if (present(line)) texts[termsLineKey(section.id as string, index)] = line;
    });
  }
  return texts;
}

/**
 * What the English review and the counsel review cover: the texts and the privacy contact, which is not
 * translated but is part of what a resident reads. scripts/content_catalogue.py computes the same value.
 */
export function termsReviewHash(terms: TermsSource, hash: Hasher): string {
  return englishReviewHash({ ...termsTexts(terms), [PRIVACY_CONTACT_KEY]: terms.privacyContact ?? "" }, hash);
}

// ---------------------------------------------------------------- the plan
/** One text of the page: in `lang`, and `unavailable` when it is English standing in for a missing translation. */
export interface TermsText {
  text: string;
  lang: LangCode;
  /** True: show it in English with translation.unavailable. */
  unavailable: boolean;
}

export interface TermsDocument {
  title: TermsText;
  sections: { id: string; heading: TermsText; lines: TermsText[] }[];
}

export interface UnavailableTermsText {
  key: string;
  lang: Exclude<LangCode, "en">;
  reason: UnavailableReason;
}

export interface TermsPlan {
  /** True only when every rule above holds: the one state in which the terms may be shown as final and signed up to. */
  published: boolean;
  /** Why it is not published (empty when it is). */
  reasons: string[];
  consentVersion: string | null;
  owner: string | null;
  lastUpdated: string | null;
  privacyContact: string | null;
  /** The text of every language, built even when the terms are not published (the draft view needs it). */
  documents: Record<LangCode, TermsDocument>;
  report: { loaded: number; unavailable: UnavailableTermsText[] };
}

function buildDocument(
  terms: TermsSource,
  lang: LangCode,
  translations: TermsInput["translations"],
  hash: Hasher,
  report: TermsPlan["report"],
  count: boolean,
): TermsDocument {
  const resolve = (key: string, english: string): TermsText => {
    if (lang === "en") return { text: english, lang: "en", unavailable: false };
    const result = evaluateTranslation(lang, key, english, translations, hash, REQUIRED_TOKENS);
    if ("loaded" in result) {
      if (count) report.loaded += 1;
      return { text: result.loaded.text, lang, unavailable: false };
    }
    if (count) report.unavailable.push({ key, lang, reason: "blank" in result ? "incomplete_record" : result.unavailable });
    return { text: english, lang: "en", unavailable: true };
  };
  const texts = termsTexts(terms);
  return {
    title: resolve(termsTitleKey, texts[termsTitleKey] ?? ""),
    sections: (terms.sections ?? [])
      .filter((section) => present(section.id))
      .map((section) => {
        const id = section.id as string;
        return {
          id,
          heading: resolve(termsHeadingKey(id), texts[termsHeadingKey(id)] ?? ""),
          lines: (section.lines ?? [])
            .map((line, index) => (present(line) ? resolve(termsLineKey(id, index), line) : null))
            .filter((line): line is TermsText => line !== null),
        };
      }),
  };
}

/** Why the English terms cannot be published, or an empty list. */
export function termsRefusals(terms: TermsSource, { hash, today }: TermsPlanOptions): string[] {
  const reasons: string[] = [];
  const currentHash = termsReviewHash(terms, hash);

  const attribution = checkAttribution(terms, currentHash, today);
  if ("reasons" in attribution) reasons.push(...attribution.reasons);

  if (!present(terms.privacyContact)) reasons.push("no privacy contact is named");
  else if (isPlaceholder(terms.privacyContact)) reasons.push("the privacy contact is still a placeholder");

  if (!present(terms.consentVersion)) reasons.push("no consent_version");
  else if (!CONSENT_VERSION_FORMAT.test(terms.consentVersion)) reasons.push("the consent_version is not written YYYY-MM-DD.n");

  const texts = termsTexts(terms);
  if (!(termsTitleKey in texts)) reasons.push("no title");
  const sections = terms.sections ?? [];
  const ids = sections.map((section) => section.id);
  for (const id of REQUIRED_SECTIONS) {
    const section = sections.find((s) => s.id === id);
    if (!section) reasons.push(`the "${id}" section is missing`);
    else if (!present(section.heading) || !(section.lines ?? []).some(present)) reasons.push(`the "${id}" section has no heading or no text`);
  }
  if (new Set(ids).size !== ids.length) reasons.push("a section id appears twice");
  const english = Object.values(texts).join(" ");
  for (const { fact, pattern } of REQUIRED_FACTS) {
    if (!pattern.test(english)) reasons.push(`the English no longer says ${fact}`);
  }
  if (/PLACEHOLDER/i.test(english)) reasons.push("the English text still holds a placeholder");

  // The counsel gate.
  const counsel = terms.counselReview;
  if (!counsel || (!present(counsel.reviewer) && !counsel.date && !present(counsel.version) && !present(counsel.sourceHash))) {
    reasons.push("counsel review: none is recorded");
  } else {
    if (!present(counsel.reviewer) || isPlaceholder(counsel.reviewer)) reasons.push("counsel review: no named reviewer");
    if (!isIsoDate(counsel.date)) reasons.push("counsel review: no valid date");
    else {
      if (counsel.date > today) reasons.push("counsel review: dated in the future");
      if (isIsoDate(terms.lastUpdated) && counsel.date < terms.lastUpdated) {
        reasons.push("counsel review: dated before the last update, so a new review is needed");
      }
    }
    if (present(terms.consentVersion) && counsel.version !== terms.consentVersion) {
      reasons.push(`counsel review: covers version ${counsel.version ?? "none"}, not ${terms.consentVersion}`);
    }
    if (!present(counsel.sourceHash)) reasons.push("counsel review: records no source hash (the text it reviewed)");
    else if (counsel.sourceHash !== currentHash) {
      reasons.push("counsel review: the terms changed since counsel reviewed them, so a new review is needed");
    }
  }
  return reasons;
}

/** What may be published and shown from the terms files, and why not when it may not. */
export function planTerms(input: TermsInput, options: TermsPlanOptions): TermsPlan {
  const { terms, translations } = input;
  const reasons = termsRefusals(terms, options);
  const report: TermsPlan["report"] = { loaded: 0, unavailable: [] };
  const documents = {} as Record<LangCode, TermsDocument>;
  documents.en = buildDocument(terms, "en", translations, options.hash, report, false);
  for (const lang of TRANSLATED_LANGS) documents[lang] = buildDocument(terms, lang, translations, options.hash, report, true);
  return {
    published: reasons.length === 0,
    reasons,
    consentVersion: present(terms.consentVersion) ? terms.consentVersion : null,
    owner: present(terms.owner) ? terms.owner : null,
    lastUpdated: present(terms.lastUpdated) ? terms.lastUpdated : null,
    privacyContact: present(terms.privacyContact) ? terms.privacyContact : null,
    documents,
    report,
  };
}

/** The report as lines for the terminal and the CI log. */
export function formatTermsReport(plan: TermsPlan): string[] {
  const lines: string[] = [];
  if (plan.published) lines.push(`Terms ${plan.consentVersion} published`);
  else {
    lines.push("Terms NOT published (draft):");
    for (const reason of plan.reasons) lines.push(`  ${reason}`);
  }
  lines.push(`Terms translations loaded: ${plan.report.loaded}`);
  const per = new Map<string, number>();
  for (const u of plan.report.unavailable) per.set(u.lang, (per.get(u.lang) ?? 0) + 1);
  if (per.size > 0) {
    lines.push(
      `Terms texts shown in English with translation.unavailable: ${plan.report.unavailable.length} (${[...per].map(([l, n]) => `${l} ${n}`).join(", ")})`,
    );
  }
  return lines;
}
