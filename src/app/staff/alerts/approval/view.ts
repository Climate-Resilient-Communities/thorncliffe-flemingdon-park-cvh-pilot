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
import { approveHref, sendingHref, updateHref } from "../pages";
import type { SendingBlock } from "../sending/view";
import { typeName } from "../typeNames";
import { exerciseWords, type ExerciseWords } from "../../ExerciseMarker";
import { approvalProcedure, procedureLink, type ProcedureLinkView } from "../../procedures";

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
  next: { title: string; lines: string[]; links: { id: "home" | "update" | "promote" | "sending"; href: string; label: string }[] };
}

export interface ApprovalScreen {
  /** O-05 for an alert; O-07 for a post by a building ambassador. */
  variant: "alert" | "ambassador";
  ref: { alertId: string; entryId: string };
  /** Where the page loads again from. */
  here: string;
  title: string;
  lead: string;
  /** The written procedure this approval belongs to (S09.03), linked last in the view, after everything the approver should know about the entry. */
  procedure: ProcedureLinkView;
  status: "review" | "locked";
  /** Why the entry is not waiting for this person (a locked screen), and the note sent with a return. */
  locked?: { message: string; note?: string };
  /**
   * UAT F-4: the entry is a draft again (returned to its author, or pulled back): its texts were cleared, so there is nothing to count, price or read in another
   * language until it is submitted again. The screen then says only that it waits for its author, with the note sent, and the English text as it stands; it does
   * not show the recipients, the cost or the languages, which would read as an outage.
   */
  awaitingAuthor: boolean;
  /**
   * UAT F-3: why Approve is not offered although the entry waits for approval: a correction or a withdrawal whose entry was corrected or withdrawn since. Only
   * Discard is offered then. Null when Approve is offered.
   */
  approveBlocked: string | null;
  /**
   * "Texts are paused; this will send when resumed" while all texts are paused (S06.06's `pauseNoticeForApprover()`), on the approval view and on
   * the confirmation of an approval (the screen of an approved entry); null otherwise. It informs and never changes or refuses the approval.
   */
  pauseNotice: string | null;
  /**
   * "With this alert ... {n} over the monthly cap" when month-to-date text spending plus this entry's estimate would pass the cap (S07.08), shown before
   * the approver decides. It informs and never changes or refuses the approval. Absent or null otherwise.
   */
  capNotice?: string | null;
  /**
   * S08.08: "Nobody is on duty for check-ins ..." when approving this entry starts or adds to a check-in round and no on-duty Admin is set (its escalations
   * then go to every on-call number), shown before the approver decides. It informs and never changes or refuses the approval. Absent or null otherwise.
   */
  onDutyNotice?: string | null;
  /**
   * Set for a pending post that residents already read on the web, marked "Not yet verified" (D-1, S08.03): the approver is told so, its texts go out only on approval,
   * and it cannot be returned to its author (a web-published entry never returns to draft). Null for every other entry.
   */
  live: { text: string } | null;
  /** `update`: this is an update to an alert residents already read (S05.01); null for a thread's first entry. */
  header: { types: string; submitted: string; drill: string | null; exercise: ExerciseWords | null; by: string | null; update: string | null };
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
   * Set for an approved entry of a real alert (S06.09): what became of its texts, per language, or a note that it could not be read. Absent for a drill (its
   * results are on the Drills page) and for every entry that is not approved.
   */
  sending?: SendingBlock;
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
  /**
   * What approving a final message does (S05.03, O-16): it closes the alert as resolved, and goes to everyone who got any entry of the alert, on the channels they got it on,
   * as well as to everyone in its audience. Null for every other entry.
   */
  closing: { title: string; reach: string; closes: string } | null;
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
  /** The sentence about the monthly spending cap when this entry would pass it (`capNoticeFor`, S07.08); null or left out when it would not. */
  capNotice?: string | null;
  /** The sentence when this entry starts or adds to a round while nobody is on duty for check-ins (`onDutyNoticeFor`, S08.08); null or left out otherwise. */
  onDutyNotice?: string | null;
  /** Whether residents are shown alerts at all (`residentAlertsEnabled()`): the launch switch. Left out, it is on. */
  residentAlertsEnabled?: boolean;
  /** The sending progress of an approved entry (`sendingBlock()`, S06.09); left out, none is shown. */
  sending?: SendingBlock | null;
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

/**
 * What the entry's texts will be counted at in the month's spending (S07.08): each text's own estimate rounded up to a whole cent, as the outbox stores it
 * (`alertTextsOf`) and the spend record counts it, times the number of people who get that language's text. This is the figure the spend cap is judged
 * with, so it can be a few cents more than the cost line above (which rounds the whole group once). Null when it cannot be worked out.
 */
export function spendEstimateCents(sms: EntryReview["sms"], counts: RecipientCounts, price: number): number | null {
  if (Object.keys(sms).length === 0) return null;
  try {
    let total = 0;
    for (const [lang, people] of Object.entries(counts.byLanguage) as [string, number][]) {
      if (!people) continue;
      const body = sms[lang];
      if (!body) return null;
      total += people * estimateSmsCost({ segmentsByLanguage: { [lang]: body.segments }, recipientsByLanguage: { [lang]: 1 }, pricePerSegmentCents: price, basis: "snapshot" }).cents;
    }
    return total;
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
    // Said once, at the top of the screen, while it waits for approval (UAT F-3: `approveBlocked`); here for an entry that no longer waits.
    gone: target.valid || entry.status === "pending_approval" ? null : t("targetGone"),
  };
}

/** What approving a final message does, in words (S05.03): null for every other entry, and for a final that is not waiting. */
function closingOf(review: EntryReview, t: Text): ApprovalScreen["closing"] {
  if (review.entry.kind !== "final" || review.closesThread !== true) return null;
  return { title: t("closingTitle"), reach: t("closingReach"), closes: t("closingCloses") };
}

/** The approval view of an entry as the server stores it, for a person looking at it. */
export function approvalScreen(input: ApprovalInput): ApprovalScreen {
  const t = input.text ?? catalogText;
  const compose: Text = input.text ?? ((key, values) => englishText(`staff.compose.${key}`, values));
  const audienceText: Text = input.text ?? ((key, values) => englishText(`staff.audience.${key}`, values));
  const { review } = input;
  const { entry, thread } = review;
  const ref = { alertId: thread.id, entryId: entry.id };
  // O-07 is a post whose frozen texts say "Building ambassador, {building}" (S08.02): what was frozen at submit, never the author's role now, so a role changed
  // since cannot show one view over texts that say the other. A draft has no texts yet: its author's role says.
  const variant = (review.attribution ? review.attribution.role === "ambassador" : review.authorRole === "ambassador") ? "ambassador" : "alert";
  const open = review.recipients.open;
  const aside = asideOf(entry.content.audience, input.plans, { href: "", label: "" }, audienceText);
  // An update says what it changes about who the thread is for, in the audience catalog's words (S05.01); nothing is said when it changes nothing.
  const changed = review.threadAudience === null ? null : changeView(review.threadAudience, entry.content.audience, input.plans, audienceText);
  const change = changed !== null && (changed.alsoFor !== null || changed.noLongerFor !== null) ? changed : null;

  const fallbackLangs = review.texts.filter((text) => text.status === "fallback_en").map((text) => text.lang as LangCode);
  const fallbackRecipients = open ? fallbackLangs.reduce((sum, lang) => sum + (review.recipients.byLanguage[lang] ?? 0), 0) : 0;
  const hasTexts = review.texts.length > 0;
  const live = entry.status === "pending_approval" && entry.webPublishedAt !== null;
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
    const withdrawal = entry.kind === "withdrawal";
    const correction = entry.kind === "correction";
    const final = entry.kind === "final";
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
                : withdrawal
                  ? t("published.webWithdrawn")
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
    // A withdrawal is read as a reason in the place of an entry, so it has no validity of its own and nothing to add an update to; a final closes the alert, so its
    // 24 hours of "until resolved" is not the alert's validity either.
    if (!withdrawal && !final) rows.push({ id: "valid", label: t("published.validLabel"), value: formatTorontoDateTime(entry.content.validUntil) });
    const open = thread.status === "open" && !withdrawal;
    const ack = entry.kind === "ack";
    return {
      title: drill
        ? t("published.titleDrill")
        : withdrawal
          ? t("published.titleWithdrawal")
          : final
            ? t("published.titleFinal")
            : correction
            ? t("published.titleCorrection")
            : ack
              ? t("published.titleAck")
              : t("published.titleAlert"),
      drill: drill ? t("published.leadDrill") : null,
      whereTitle: t("published.whereTitle"),
      rows,
      next: {
        title: t("published.nextTitle"),
        lines: open ? [ack ? t("published.nextPromote") : t("published.nextUpdate")] : final && !drill ? [t("published.nextFinal")] : [],
        links: [
          { id: "home", href: "/staff", label: t("published.toHome") },
          ...(drill ? [] : [{ id: "sending" as const, href: sendingHref({ alertId: thread.id, entryId: entry.id }), label: t("published.toSending") }]),
          ...(open ? [{ id: ack ? ("promote" as const) : ("update" as const), href: updateHref(thread.id, ack), label: ack ? t("published.toPromote") : t("published.toUpdate") }] : []),
        ],
      },
    };
  }

  return {
    variant,
    ref,
    here: approveHref(ref),
    procedure: procedureLink(approvalProcedure(entry.kind, thread.isDrill)),
    title: entry.kind === "correction" ? t("correctionTitle") : entry.kind === "withdrawal" ? t("withdrawalTitle") : entry.kind === "final" ? t("finalTitle") : variant === "alert" ? t("title") : t("ambassadorTitle"),
    lead: entry.kind === "correction" ? t("correctionLead") : entry.kind === "withdrawal" ? t("withdrawalLead") : entry.kind === "final" ? t("finalLead") : variant === "alert" ? t("lead") : t("ambassadorLead"),
    status: locked ? "locked" : "review",
    ...(locked ? { locked } : {}),
    awaitingAuthor: entry.status === "draft",
    approveBlocked: !locked && review.target && !review.target.valid && (entry.kind === "correction" || entry.kind === "withdrawal") ? t("targetGone") : null,
    // Told where it matters: to the approver deciding (an entry waiting for them), and on the confirmation (an approved entry), not on an entry that
    // was returned, discarded or is waiting for someone else, whose texts the pause does not hold.
    pauseNotice: input.pauseNotice && (!locked || entry.status === "approved") ? input.pauseNotice : null,
    // The cap is told before the decision, to the approver deciding: not on an entry that is not waiting for them.
    capNotice: input.capNotice && !locked && entry.status === "pending_approval" ? input.capNotice : null,
    // Nobody on duty for check-ins (S08.08): told to the approver deciding, as the cap is.
    onDutyNotice: input.onDutyNotice && !locked && entry.status === "pending_approval" ? input.onDutyNotice : null,
    header: {
      types: entry.content.types.map(typeName).join(", "),
      submitted: entry.submittedAt ? t("submitted", { time: formatTorontoDateTime(entry.submittedAt), version: entry.version }) : "",
      drill: thread.isDrill ? t("drill") : null,
      exercise: thread.isDrill ? exerciseWords() : null,
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
    live: live ? { text: t("liveWeb") } : null,
    ...(published ? { published } : {}),
    ...(published && input.sending ? { sending: input.sending } : {}),
    allTranslated: hasTexts && fallbackLangs.length === 0 ? t("allTranslated") : null,
    replaces: replacesOf(review, t, compose),
    closing: closingOf(review, t),
    duplicate: entry.possibleDuplicateOf
      ? { text: t("duplicate"), link: review.duplicate?.entryId ? { href: approveHref({ alertId: review.duplicate.alertId, entryId: review.duplicate.entryId }), label: t("duplicateLink") } : null }
      : null,
    cannotEdit: t(live ? "cannotEditLive" : "cannotEdit"),
    languages: { title: t("languagesTitle"), lead: t("languagesLead"), webLabel: t("webText"), rows: languageRows },
    binding: { version: entry.version, contentHash: entry.contentHash ?? "", reviewed: encodeCounts(review.recipients), ...(review.threadCoveringId === null ? {} : { covering: review.threadCoveringId }) },
    actions: { label: t("actionsLabel"), approve: t("approve"), approveConfirmed: t("approveConfirmed"), returnToAuthor: t("returnToAuthor"), discard: t("discard") },
    returnForm: { title: t("returnTitle"), hint: t("returnHint"), noteLabel: t("noteLabel"), max: RETURN_NOTE_MAX, counter: t("noteCounter", { n: "{n}", max: RETURN_NOTE_MAX }), send: t("sendBack"), cancel: t("cancel") },
    discardForm: { title: t("discardTitle"), lead: t(live ? "discardLiveLead" : "discardLead"), confirm: t("discardConfirm"), cancel: t("cancel") },
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
