// What the approval view shows (S04.07; O-05 the approval of an alert, O-07 an ambassador's post): the view model, with every text already resolved
// from the English catalog, so the component that draws it knows none of it and the layout tests can put the longest translated labels of a language
// in every place. One screen with two states: an entry waiting for a second person (the text and what goes out, every other language one tap
// away, and Approve, Return to author and Discard), and an entry that is not waiting for this person (what became of it).
//
// Above the fold, at 390 px: the English text, the audience in words, the channels, the number of text message recipients, the estimated cost, the
// valid-until and any language that fell back. They come first in the main column; everything else (each language's web text and text message, who
// wrote it) is in the aside, which is below the main column on a phone and beside it from 800 px of content width.
import type { LangCode } from "@/contracts/lang";
import { encodeCounts, RETURN_NOTE_MAX, type RecipientCounts } from "@/contracts/alertApproval";
import { TRANSLATED_LANGS } from "@/contracts/alertContent";
import { englishText } from "@/i18n/text";
import { LAUNCH_LANGUAGES } from "@/i18n/languages";
import type { EntryReview } from "@/modules/alerting";
import { estimateSmsCost } from "@/modules/messaging";
import type { BuildingFloorPlan } from "@/modules/places";
import { formatTorontoDateTime } from "@/platform/clock";
import { changeView } from "../audience/change";
import { asideOf } from "../audience/view";
import { approveHref, updateHref } from "../pages";
import { typeName } from "../typeNames";

export type Text = (key: string, values?: Record<string, string | number>) => string;

/** The words of this screen: `staff.approve.<key>` of the catalog. */
export const catalogText: Text = (key, values) => englishText(`staff.approve.${key}`, values);

/** The refusal codes the view says in words; the rest is "That could not be done". */
export const APPROVAL_MESSAGE_CODES = [
  "ENTRY_CHANGED",
  "VALID_UNTIL_PAST",
  "EDITOR_CANNOT_APPROVE",
  "AAL2_REQUIRED",
  "NOT_ALLOWED",
  "AUTHOR_NOT_ALLOWED",
  "ENTRY_NOT_PENDING",
  "ALERT_CLOSED",
  "ALERT_NOT_FOUND",
  "ENTRY_NOT_FOUND",
  "NOTE_REQUIRED",
  "NOTE_TOO_LONG",
  "OUT_OF_SCOPE",
  "ILLEGAL_TRANSITION",
  "WEB_PUBLISHED",
  "UNKNOWN_TYPE",
  "TARGET_NOT_VALID",
  "TARGET_SUPERSEDED",
  "TARGET_NOT_PUBLISHED",
  "BUILDING_NOT_FOUND",
  "FLOOR_NOT_IN_BUILDING",
  "NEIGHBOURHOOD_NOT_FOUND",
  "AUDIENCE_INVALID",
] as const;

/** Whole cents as dollars: 150 is "$1.50" (the estimate is in cents CAD; the word CAD is the cost line's own). */
export const formatCents = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export interface LanguageReviewView {
  lang: LangCode | "en";
  native: string;
  bcp47: string;
  dir: "ltr" | "rtl";
  english: string;
  /** How the text came to be, in words. */
  state: string;
  fallback: boolean;
  /** The language's web text (null for English, which is above the fold). */
  web: string | null;
  /** The language's text message, exactly as it is sent, and its segments and encoding in words (null for a language with none). */
  sms: { summary: string; body: string } | null;
  /** "{n} text recipients" once texting is open. */
  recipients: string | null;
}

/** The recipient count the approval was refused for, in words: what the approver reads and confirms before approving the new number. */
export interface CountChangedView {
  message: string;
  nowTitle: string;
  rows: { lang: string; english: string; n: number }[];
  cost: string;
  confirm: string;
  /** The new count as the form carries it: what the next Approve names. */
  reviewed: string;
}

/** A language drawn as a pill: its own name, in its own script and direction. */
export interface PublishedLanguageView {
  lang: LangCode | "en";
  native: string;
  bcp47: string;
  dir: "ltr" | "rtl";
}

/** One row of "What went where" (O-06). */
export interface PublishedRowView {
  id: "web" | "fallback" | "texts" | "valid";
  label: string;
  value: string;
  /** The languages the row is about, with the label that names them for a screen reader; absent when the row names none. */
  languages?: { label: string; items: PublishedLanguageView[] };
}

/** The published confirmation (O-06): what an approved entry did, once it is approved. */
export interface PublishedView {
  title: string;
  /** A drill: what "Practice publish: nothing was sent to residents" means. */
  drill: string | null;
  whereTitle: string;
  rows: PublishedRowView[];
  next: { title: string; lines: string[]; links: { id: "home" | "update" | "promote"; href: string; label: string }[] };
}

export interface ApprovalScreen {
  /** O-05 for an alert; O-07 for a post by a building ambassador. */
  variant: "alert" | "ambassador";
  ref: { alertId: string; entryId: string };
  /** Where the page loads again from. */
  here: string;
  title: string;
  lead: string;
  status: "review" | "locked";
  /** Why the entry is not waiting for this person (a locked screen), and the note sent with a return. */
  locked?: { message: string; note?: string };
  /**
   * "Texts are paused; this will send when resumed" while all texts are paused (S06.06's `pauseNoticeForApprover()`), on the approval view and on
   * the confirmation of an approval (the screen of an approved entry); null otherwise. It informs and never changes or refuses the approval.
   */
  pauseNotice: string | null;
  /** `update`: this is an update to an alert residents already read (S05.01); null for a thread's first entry. */
  header: { types: string; submitted: string; drill: string | null; by: string | null; update: string | null };
  english: { title: string; body: string };
  facts: {
    title: string;
    /**
     * `change`: what an update changes about who the thread is for, against the audience it has now (S05.01): "Now also for: ..." for what it newly
     * reaches and "No longer for: ..." for what it stops reaching, each null when it adds or drops nothing; absent when nothing changes.
     */
    audience: { label: string; sentence: string; floorNote?: string; groups: string; change?: { alsoFor: string | null; noLongerFor: string | null } };
    channels: { label: string; items: string[] };
    recipients: { label: string; count: string; notOpen: string | null; byLanguage: { label: string; items: string[] } | null };
    cost: { label: string; value: string; note: string };
    validUntil: { label: string; value: string };
  };
  /** Set once the entry is approved (O-06): what went where. Absent for every other state. */
  published?: PublishedView;
  /**
   * What a correction or a withdrawal replaces (S05.02): the entry as residents read it now, what they will see instead, and who it goes to (everyone who got the
   * original, and everyone in its audience now). `gone` is why it cannot be approved when the entry was corrected or withdrawn since; `closes` says the alert
   * closes as withdrawn when this is approved. Null for every other entry.
   */
  replaces: {
    title: string;
    lead: string;
    target: { heading: string; text: string };
    reason: string | null;
    reach: string;
    closes: string | null;
    gone: string | null;
  } | null;
  fallback: { summary: string; recipients: string | null } | null;
  allTranslated: string | null;
  duplicate: { text: string; link: { href: string; label: string } | null } | null;
  cannotEdit: string;
  languages: { title: string; lead: string; webLabel: string; rows: LanguageReviewView[] };
  /** What the approver was shown: the version and hash an approval, a return and a discard name, and the reviewed count Approve names. */
  binding: { version: number; contentHash: string; reviewed: string; /** The entry the "Now also for" line was read against (S05.01); absent when none was shown. */ covering?: string };
  actions: { label: string; approve: string; approveConfirmed: string; returnToAuthor: string; discard: string };
  returnForm: { title: string; hint: string; noteLabel: string; max: number; counter: string; send: string; cancel: string };
  discardForm: { title: string; lead: string; confirm: string; cancel: string };
  messages: { errors: Record<string, string>; countConfirm: string };
}

export interface ApprovalInput {
  review: EntryReview;
  plans: readonly BuildingFloorPlan[];
  /** Cents CAD per segment (SMS_PRICE_PER_SEGMENT_CENTS), from the environment: domain and modules read none. */
  pricePerSegmentCents: number;
  /** The person looking: they cannot approve what they wrote or changed. */
  viewerId: string;
  /** What `pauseNoticeForApprover()` answered: the sentence while texts are paused, null otherwise (or when the switch could not be read). */
  pauseNotice?: string | null;
  /** Whether residents are shown alerts at all (`residentAlertsEnabled()`): the launch switch. Left out, it is on. */
  residentAlertsEnabled?: boolean;
  /** The words of the screen; the layout tests give the longest labels of a language here, in every place the screen shows text. */
  text?: Text;
}

const WORDS = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** Segments of each language's frozen text message. */
const segmentsOf = (sms: EntryReview["sms"]): Record<string, number> => Object.fromEntries(Object.entries(sms).map(([lang, body]) => [lang, body.segments]));

/** The estimated cost of a count in whole cents (segments × recipients × the price), or null when it cannot be estimated: no text messages, or a language with recipients and no text. */
function estimatedCents(sms: EntryReview["sms"], counts: RecipientCounts, price: number): number | null {
  if (Object.keys(sms).length === 0) return null;
  try {
    return estimateSmsCost({ segmentsByLanguage: segmentsOf(sms), recipientsByLanguage: counts.byLanguage as Record<string, number>, pricePerSegmentCents: price, basis: "snapshot" }).cents;
  } catch {
    return null;
  }
}

/** The English name and the native name of a language, from the launch list (the composer's names; zh-Hant is its own, and English is this screen's). */
function languageNames(lang: LangCode, compose: Text, t: Text): { native: string; bcp47: string; dir: "ltr" | "rtl"; english: string } {
  if (lang === "en") return { native: "English", bcp47: "en", dir: "ltr", english: t("languageEnglish") };
  const launch = LAUNCH_LANGUAGES.find((language) => language.code === lang);
  return {
    native: launch?.native ?? compose("languageNative.zh-Hant"),
    bcp47: launch?.bcp47 ?? "zh-Hant-TW",
    dir: launch?.dir ?? "ltr",
    english: compose(`languageNames.${lang}`),
  };
}

/** The count the approval was refused for, as the view says it (the refusal's snapshot against the count the approver reviewed). */
export function countChangedView(input: { review: EntryReview; snapshot: RecipientCounts; reviewed: RecipientCounts; pricePerSegmentCents: number; text?: Text }): CountChangedView {
  const t = input.text ?? catalogText;
  const compose: Text = input.text ?? ((key, values) => englishText(`staff.compose.${key}`, values));
  const { snapshot, reviewed } = input;
  const cents = estimatedCents(input.review.sms, snapshot, input.pricePerSegmentCents);
  const rows = (Object.entries(snapshot.byLanguage) as [LangCode, number][])
    .filter(([, n]) => n > 0)
    .map(([lang, n]) => ({ lang, english: languageNames(lang, compose, t).english, n }));
  return {
    message: snapshot.total !== reviewed.total ? t("countChanged", { a: reviewed.total, b: snapshot.total }) : t("countChangedLanguages"),
    nowTitle: t("countNow"),
    rows,
    cost: cents === null ? t("costUnknown") : t("costNow", { amount: formatCents(cents) }),
    confirm: t("countConfirm"),
    reviewed: encodeCounts(snapshot),
  };
}

/** What a correction or a withdrawal replaces, in words (S05.02): null for an entry that replaces nothing. */
function replacesOf(review: EntryReview, t: Text, compose: Text): ApprovalScreen["replaces"] {
  const { entry, target } = review;
  if ((entry.kind !== "correction" && entry.kind !== "withdrawal") || !target) return null;
  const withdrawal = entry.kind === "withdrawal";
  return {
    title: t("replacesTitle"),
    lead: withdrawal ? t("replacesWithdrawal") : t("replacesCorrection"),
    target: { heading: t("replacesEntry", { kind: compose(`thread.kind.${target.kind}`), time: target.publishedAt ? formatTorontoDateTime(target.publishedAt) : "" }), text: target.text },
    reason: withdrawal && entry.withdrawalReason ? t("withdrawalReason", { reason: englishText(`staff.correct.reasons.${entry.withdrawalReason}`) }) : null,
    // The rule of AD-7, in words for the approver: a correction or a withdrawal reaches everyone who got the original, as well as the people in its own audience now.
    reach: t("reachesOriginal"),
    closes: review.closesThread === true ? t("closesThread") : null,
    gone: target.valid ? null : t("targetGone"),
  };
}

/** The approval view of an entry as the server stores it, for a person looking at it. */
export function approvalScreen(input: ApprovalInput): ApprovalScreen {
  const t = input.text ?? catalogText;
  const compose: Text = input.text ?? ((key, values) => englishText(`staff.compose.${key}`, values));
  const audienceText: Text = input.text ?? ((key, values) => englishText(`staff.audience.${key}`, values));
  const { review } = input;
  const { entry, thread } = review;
  const ref = { alertId: thread.id, entryId: entry.id };
  const variant = review.authorRole === "ambassador" ? "ambassador" : "alert";
  const open = review.recipients.open;
  const aside = asideOf(entry.content.audience, input.plans, { href: "", label: "" }, audienceText);
  // An update says what it changes about who the thread is for, in the audience catalog's words (S05.01); nothing is said when it changes nothing.
  const changed = review.threadAudience === null ? null : changeView(review.threadAudience, entry.content.audience, input.plans, audienceText);
  const change = changed !== null && (changed.alsoFor !== null || changed.noLongerFor !== null) ? changed : null;

  const fallbackLangs = review.texts.filter((text) => text.status === "fallback_en").map((text) => text.lang as LangCode);
  const fallbackRecipients = open ? fallbackLangs.reduce((sum, lang) => sum + (review.recipients.byLanguage[lang] ?? 0), 0) : 0;
  const hasTexts = review.texts.length > 0;
  const cost = estimatedCents(review.sms, review.recipients, input.pricePerSegmentCents);

  // What became of an entry that is not waiting for this person.
  let locked: ApprovalScreen["locked"];
  if (thread.status !== "open" && entry.status === "pending_approval") locked = { message: t("locked.closed") };
  else if (entry.status === "pending_approval") locked = entry.editorIds.includes(input.viewerId) ? { message: t("locked.own") } : undefined;
  else if (entry.status === "approved") locked = { message: t("locked.approved") };
  else if (entry.status === "discarded") locked = { message: t("locked.discarded") };
  else if (entry.status === "draft") locked = entry.returnedFor === "return" && entry.returnedNote ? { message: t("locked.returned"), note: t("sentNote", { note: entry.returnedNote }) } : { message: t("locked.draft") };
  else locked = { message: t("locked.other") };

  const messages = {
    errors: {
      ...Object.fromEntries(APPROVAL_MESSAGE_CODES.map((code) => [code, t(`errors.${code}`, { max: RETURN_NOTE_MAX })])),
      forbidden: t("errors.forbidden"),
      invalid: t("errors.invalid"),
    },
    countConfirm: t("countConfirm"),
  };

  const languageRows: LanguageReviewView[] = [
    // English first: its text is above the fold, so here it is the text message only.
    {
      lang: "en",
      native: "English",
      bcp47: "en",
      dir: "ltr",
      english: t("languageEnglish"),
      state: t("languageStates.source"),
      fallback: false,
      web: null,
      sms: review.sms.en ? { summary: t("smsText", { segments: review.sms.en.segments, encoding: t(`encoding.${review.sms.en.encoding}`) }), body: review.sms.en.body } : null,
      recipients: open ? t("languageRecipients", { n: review.recipients.byLanguage.en ?? 0 }) : null,
    },
    ...TRANSLATED_LANGS.map((lang): LanguageReviewView => {
      const names = languageNames(lang, compose, t);
      const text = review.texts.find((candidate) => candidate.lang === lang);
      const sms = review.sms[lang];
      return {
        lang,
        ...names,
        state: text ? t(`languageStates.${text.status}`) : t("languageStates.fallback_en"),
        fallback: text?.status === "fallback_en",
        web: text ? text.body : null,
        sms: sms ? { summary: t("smsText", { segments: sms.segments, encoding: t(`encoding.${sms.encoding}`) }), body: sms.body } : null,
        recipients: open ? t("languageRecipients", { n: review.recipients.byLanguage[lang] ?? 0 }) : null,
      };
    }),
  ];

  const byLanguage = open
    ? (Object.entries(review.recipients.byLanguage) as [LangCode, number][])
        .filter(([, n]) => n > 0)
        .map(([lang, n]) => `${languageNames(lang, compose, t).english}: ${n}`)
    : [];

  // The published confirmation (O-06): the web in which languages, the languages that fell back to English, and the texts that go out once texting is live.
  const languageView = (lang: LangCode): PublishedLanguageView => {
    const { native, bcp47, dir } = languageNames(lang, compose, t);
    return { lang, native, bcp47, dir };
  };
  const published = entry.status === "approved" ? publishedOf() : undefined;
  function publishedOf(): PublishedView {
    const drill = thread.isDrill;
    const ownWords = review.texts.filter((text) => text.status !== "fallback_en").map((text) => text.lang as LangCode);
    const webLanguages: LangCode[] = ["en", ...TRANSLATED_LANGS.filter((lang) => ownWords.includes(lang))];
    const textLanguages = (["en", ...TRANSLATED_LANGS] as LangCode[]).filter((lang) => review.sms[lang] !== undefined);
    const rows: PublishedRowView[] = [
      drill
        ? { id: "web", label: t("published.webLabel"), value: t("published.webDrill") }
        : {
            id: "web",
            label: t("published.webLabel"),
            value:
              input.residentAlertsEnabled === false
                ? t("published.webOff")
                : thread.status === "open"
                  ? t("published.webValue", { n: webLanguages.length })
                  : t("published.webEnded", { n: webLanguages.length }),
            languages: { label: t("published.webLanguages"), items: webLanguages.map(languageView) },
          },
    ];
    if (!drill && fallbackLangs.length > 0) {
      rows.push({
        id: "fallback",
        label: t("published.fallbackLabel"),
        value: t("published.fallbackValue", { languages: WORDS(fallbackLangs.map((lang) => languageNames(lang, compose, t).english)) }),
        languages: { label: t("published.fallbackLabel"), items: fallbackLangs.map(languageView) },
      });
    }
    rows.push({
      id: "texts",
      label: t("published.textsLabel"),
      value: drill ? t("published.textsDrill") : textLanguages.length === 0 ? t("published.textsNone") : t("published.textsNotOpen", { n: textLanguages.length }),
      ...(!drill && textLanguages.length > 0 ? { languages: { label: t("published.textsLanguages"), items: textLanguages.map(languageView) } } : {}),
    });
    rows.push({ id: "valid", label: t("published.validLabel"), value: formatTorontoDateTime(entry.content.validUntil) });
    const open = thread.status === "open";
    const ack = entry.kind === "ack";
    return {
      title: drill ? t("published.titleDrill") : ack ? t("published.titleAck") : t("published.titleAlert"),
      drill: drill ? t("published.leadDrill") : null,
      whereTitle: t("published.whereTitle"),
      rows,
      next: {
        title: t("published.nextTitle"),
        lines: open ? [ack ? t("published.nextPromote") : t("published.nextUpdate")] : [],
        links: [
          { id: "home", href: "/staff", label: t("published.toHome") },
          ...(open ? [{ id: ack ? ("promote" as const) : ("update" as const), href: updateHref(thread.id, ack), label: ack ? t("published.toPromote") : t("published.toUpdate") }] : []),
        ],
      },
    };
  }

  return {
    variant,
    ref,
    here: approveHref(ref),
    title: entry.kind === "correction" ? t("correctionTitle") : entry.kind === "withdrawal" ? t("withdrawalTitle") : variant === "alert" ? t("title") : t("ambassadorTitle"),
    lead: entry.kind === "correction" ? t("correctionLead") : entry.kind === "withdrawal" ? t("withdrawalLead") : variant === "alert" ? t("lead") : t("ambassadorLead"),
    status: locked ? "locked" : "review",
    ...(locked ? { locked } : {}),
    // Told where it matters: to the approver deciding (an entry waiting for them), and on the confirmation (an approved entry), not on an entry that
    // was returned, discarded or is waiting for someone else, whose texts the pause does not hold.
    pauseNotice: input.pauseNotice && (!locked || entry.status === "approved") ? input.pauseNotice : null,
    header: {
      types: entry.content.types.map(typeName).join(", "),
      submitted: entry.submittedAt ? t("submitted", { time: formatTorontoDateTime(entry.submittedAt), version: entry.version }) : "",
      drill: thread.isDrill ? t("drill") : null,
      by: variant === "ambassador" ? t("ambassadorBy") : null,
      update: entry.kind === "update" && review.threadAudience !== null ? t("updateNote") : null,
    },
    english: { title: t("textTitle"), body: entry.content.text },
    facts: {
      title: t("factsTitle"),
      audience: { label: t("audience"), sentence: aside.sentence, ...(aside.floorNote ? { floorNote: aside.floorNote } : {}), groups: aside.groups, ...(change ? { change } : {}) },
      // Texting is a channel once it is open; until then the web is the only one the approval can promise. A drill reaches no resident on either (AD-6).
      channels: { label: t("channels"), items: thread.isDrill ? [t("channelDrill")] : open ? [t("channelWeb"), t("channelSms")] : [t("channelWeb")] },
      recipients: {
        label: t("recipients"),
        count: String(review.recipients.total),
        notOpen: open ? null : t("recipientsNotOpen"),
        byLanguage: byLanguage.length > 0 ? { label: t("recipientsByLanguage"), items: byLanguage } : null,
      },
      cost: { label: t("cost"), value: cost === null ? t("costUnknown") : t("costValue", { amount: formatCents(cost) }), note: t("costNote") },
      validUntil: { label: t("validUntil"), value: t("validUntilValue", { time: formatTorontoDateTime(entry.content.validUntil) }) },
    },
    fallback:
      fallbackLangs.length > 0
        ? {
            summary: t("fallbackSummary", { n: fallbackLangs.length, total: TRANSLATED_LANGS.length, languages: WORDS(fallbackLangs.map((lang) => languageNames(lang, compose, t).english)) }),
            recipients: open && fallbackRecipients > 0 ? t("fallbackRecipients", { n: fallbackRecipients }) : null,
          }
        : null,
    ...(published ? { published } : {}),
    allTranslated: hasTexts && fallbackLangs.length === 0 ? t("allTranslated") : null,
    replaces: replacesOf(review, t, compose),
    duplicate: entry.possibleDuplicateOf
      ? { text: t("duplicate"), link: review.duplicate?.entryId ? { href: approveHref({ alertId: review.duplicate.alertId, entryId: review.duplicate.entryId }), label: t("duplicateLink") } : null }
      : null,
    cannotEdit: t("cannotEdit"),
    languages: { title: t("languagesTitle"), lead: t("languagesLead"), webLabel: t("webText"), rows: languageRows },
    binding: { version: entry.version, contentHash: entry.contentHash ?? "", reviewed: encodeCounts(review.recipients), ...(review.threadCoveringId === null ? {} : { covering: review.threadCoveringId }) },
    actions: { label: t("actionsLabel"), approve: t("approve"), approveConfirmed: t("approveConfirmed"), returnToAuthor: t("returnToAuthor"), discard: t("discard") },
    returnForm: { title: t("returnTitle"), hint: t("returnHint"), noteLabel: t("noteLabel"), max: RETURN_NOTE_MAX, counter: t("noteCounter", { n: "{n}", max: RETURN_NOTE_MAX }), send: t("sendBack"), cancel: t("cancel") },
    discardForm: { title: t("discardTitle"), lead: t("discardLead"), confirm: t("discardConfirm"), cancel: t("cancel") },
    messages,
  };
}

/** The screen for an entry that is not there. */
export interface MissingApproval {
  kind: "missing";
  message: string;
  back: { href: string; label: string };
}

export function missingApproval(t: Text = catalogText): MissingApproval {
  return { kind: "missing", message: t("missing"), back: { href: "/staff", label: t("back") } };
}
