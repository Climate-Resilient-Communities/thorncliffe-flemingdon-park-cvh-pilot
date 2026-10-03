// What the composers show (S04.05; O-12 the acknowledgement, O-02 the full alert): the view model, with every text already resolved from
// the English catalog, so the component that draws it knows none of it and the layout tests can put the longest translated labels of a
// language in every place. A composer is one screen with three states: a draft being written, a submitted entry waiting for approval,
// and an entry that can no longer be changed here.
import type { Audience } from "@/contracts/audience";
import type { LanguageResult } from "@/contracts/alertSubmit";
import type { LangCode } from "@/contracts/lang";
import { englishText } from "@/i18n/text";
import { LAUNCH_LANGUAGES } from "@/i18n/languages";
import { ALERT_TEXT_MAX, BUILDING_TYPES, NEIGHBOURHOOD_ONLY_TYPES as NEIGHBOURHOOD_TYPES, TRANSLATED_LANGS as FROZEN_LANGS } from "@/contracts/alertContent";
import type { EntryState, ThreadSummary, UpdateStart } from "@/modules/alerting";
import type { RenderedSms } from "@/modules/messaging";
import type { BuildingFloorPlan } from "@/modules/places";
import { asideOf, type AsideView } from "../audience/view";
import { changeView, type ChangeView } from "../audience/change";
import { composerPage, type ComposerFrom } from "../pages";
import { GROUPS_PAGE, PLACE_PAGE, type DraftRef } from "../audience/editAudience";
import { fieldsOfStoredInstant, type TimeFields } from "../timeField";
import { typeName } from "../typeNames";
import { formatTorontoDateTime } from "@/platform/clock";

export type Text = (key: string, values?: Record<string, string | number>) => string;

/** The words of this screen: `staff.compose.<key>` of the catalog. */
export const catalogText: Text = (key, values) => englishText(`staff.compose.${key}`, values);

/**
 * The composers: the acknowledgement (O-12), the alert (O-02), an update to a running alert (O-14) and the promotion of an acknowledgement to a full alert (O-13,
 * which is the first update; S05.01). The last two are one composer with its own words, and start from the alert they add to.
 */
export type ComposerMode = "ack" | "alert" | "update" | "promote";

/** An update added to a running alert: the thread's types, audience and languages are carried over, and the phase is required (S05.01). */
export const isFollowUpMode = (mode: ComposerMode): mode is "update" | "promote" => mode === "update" || mode === "promote";

/** The page a mode is written on, the way the audience pages and the forms name it. */
export const fromOfMode = (mode: ComposerMode): ComposerFrom => (mode === "alert" ? "compose" : mode);

/** The mode of a page. */
export const modeOfFrom = (from: ComposerFrom): ComposerMode => (from === "compose" ? "alert" : from);

export interface LanguageRowView {
  lang: LangCode;
  native: string;
  bcp47: string;
  dir: "ltr" | "rtl";
  english: string;
  /** `waiting` before a submit, then how the text came to be. */
  state: "waiting" | LanguageResult;
  /** The words for that state. */
  stateLabel: string;
}

export interface ChoiceView {
  id: string;
  label: string;
  checked: boolean;
}

/** The form of a draft being written. */
export interface DraftFormView {
  text: { label: string; hint: string; value: string; max: number; counter: string };
  /** The full alert composer lets the author change the types; the acknowledgement shows them. */
  types: { legend: string; building: ChoiceView[]; neighbourhood: ChoiceView[] } | null;
  typesSummary: string;
  /** `required`: an update's author chooses where things stand, so the radios start unchecked on a new update and the form needs one (S05.01). */
  phase: { legend: string; items: ChoiceView[]; required: boolean; hint: string | null } | null;
  valid: {
    title: string;
    hint: string;
    resolvedLabel: string;
    atLabel: string;
    dateLabel: string;
    timeLabel: string;
    foldLegend: string;
    mode: "resolved" | "at";
    fields: TimeFields;
  };
}

/** A submitted entry waiting for a second person. */
export interface PendingView {
  title: string;
  lead: string;
  version: number;
  /** The hash the person saw: "Try translation again" names it, so a changed entry is refused. */
  contentHash: string;
  fallback: { summary: string; retry: string; retryNote: string } | null;
  allTranslated: string | null;
  pullBack: { label: string; note: string };
  duplicate: string | null;
}

export interface PreviewView {
  title: string;
  lead: string;
  /** The text message, line by line. */
  lines: string[];
  note: string;
  segments: number;
}

/** The running alert as residents read it (S05.01): the entries newest first, each with its time and where things stood, and the valid-until the thread has. */
export interface ThreadDigestView {
  title: string;
  lead: string;
  validUntil: string;
  entries: { key: string; heading: string; phase: string; text: string }[];
}

export interface ComposerMessages {
  /** By refusal or failure code, plus NOT_REACHED. */
  errors: Record<string, string>;
  running: { title: string; lead: string; leadUnknown: string; summary: string; lost: string; waiting: string };
  result: Record<LanguageResult, string>;
}

/** What a running attempt looks like to someone who comes back to the entry. */
export interface ResumeView {
  key: string;
  kind: "submit" | "retranslate";
  budgetMs: number | null;
  progress: Record<string, string>;
}

export interface ComposerScreen {
  mode: ComposerMode;
  /** The page this composer is: the forms send it back as `from`, so a saved draft and the audience pages lead back to the right composer. */
  from: ComposerFrom;
  ref: DraftRef;
  title: string;
  lead: string;
  firstReport: string;
  benchmark: string;
  /** `new`: an update whose draft is not made yet (S05.01): saving makes it. */
  status: "new" | "draft" | "pending" | "locked";
  notice?: string;
  /** Why the last attempt failed, shown on the draft it left. */
  failure?: string;
  /** The note an approver wrote when they sent the entry back (S04.07), shown on the draft until it is submitted again. */
  returned?: { title: string; lead: string; note: string };
  locked?: string;
  draft?: DraftFormView;
  pending?: PendingView;
  preview: PreviewView | null;
  /** The running alert an update adds to, as residents read it now (S05.01); only on the update composers. */
  thread?: ThreadDigestView;
  /** What saving does, on a new update. */
  startNote?: string;
  languages: { title: string; lead: string; rows: LanguageRowView[] };
  aside: AsideView & {
    groupsLink: { href: string; label: string };
    channelsTitle: string;
    channels: string[];
    /** On the update composers: what is carried over from the alert, and what this update changes about who it is for (what the approver reads as "Now also for"). */
    carried?: string;
    change?: ChangeView & { same: string | null };
  };
  actions: { label: string; save: string; submit: string };
  resume: ResumeView | null;
  /** The key of the entry's latest attempt, whatever became of it: a key the browser kept that equals it is confirmed (its outcome is on this screen). */
  lastAttemptKey: string | null;
  messages: ComposerMessages;
  /** Where the page loads again from (a committed or failed attempt, a refusal): this composer's own address. */
  here: string;
}

export interface ComposerInput {
  mode: ComposerMode;
  state: EntryState;
  plans: readonly BuildingFloorPlan[];
  /** The English text message of the saved draft, and whether its 911 line comes first (messaging's isNineOneOneFirst: fire and "Other"). */
  preview: { sms: RenderedSms; nineOneOneFirst: boolean } | null;
  saved: boolean;
  now: Date;
  /** The thread an update adds to (S05.01): what residents read now, and the audience it has now, which the update's own is compared with. */
  thread?: ThreadSummary | null;
  /** The words of the screen; the layout tests give the longest labels of a language here, in every place the screen shows text. */
  text?: Text;
}

/** The refusal and failure codes the composer can say, in words; the rest is "That could not be done". */
export const MESSAGE_CODES = [
  "DRAFT_CHANGED",
  "ROUTES_UNAVAILABLE",
  "ROUTES_INVALID",
  "SMS_BODY_TOO_LONG",
  "TRANSLATION_STALE",
  "PREPARATION_FAILED",
  "SUBMIT_IN_PROGRESS",
  "SUBMIT_ABANDONED",
  "SUBMIT_KEY_INVALID",
  "VALID_UNTIL_PAST",
  "VALID_UNTIL_TOO_FAR",
  "VALID_UNTIL_INVALID",
  "TEXT_EMPTY",
  "TEXT_TOO_LONG",
  "TYPES_EMPTY",
  "TYPES_REPEATED",
  "PHASE_INVALID",
  "NEIGHBOURHOOD_ONLY_TYPE",
  "NOT_ALLOWED",
  "AUTHOR_NOT_ALLOWED",
  "OUT_OF_SCOPE",
  "ILLEGAL_TRANSITION",
  "WEB_PUBLISHED",
  "ENTRY_NOT_PENDING",
  "ENTRY_CHANGED",
  "ALERT_CLOSED",
  "ALERT_NOT_FOUND",
  "ENTRY_NOT_FOUND",
  "AUDIENCE_INVALID",
  "BUILDING_NOT_FOUND",
  "FLOOR_NOT_IN_BUILDING",
  "NEIGHBOURHOOD_NOT_FOUND",
  "NO_PUBLISHED_ENTRY",
  "ENTRY_ID_INVALID",
  "TYPES_CHANGED",
] as const;

const WAITING = "waiting" as const;

function typeChoices(ids: readonly string[], ticked: ReadonlySet<string>): ChoiceView[] {
  return ids.map((id) => ({ id, label: typeName(id), checked: ticked.has(id) }));
}

function languageRows(results: ReadonlyMap<string, LanguageResult>, t: Text): LanguageRowView[] {
  return FROZEN_LANGS.map((lang) => {
    const launch = LAUNCH_LANGUAGES.find((language) => language.code === lang);
    const state = results.get(lang) ?? WAITING;
    return {
      lang,
      native: launch?.native ?? t("languageNative.zh-Hant"),
      bcp47: launch?.bcp47 ?? "zh-Hant-TW",
      dir: launch?.dir ?? "ltr",
      english: t(`languageNames.${lang}`),
      state,
      stateLabel: state === WAITING ? t("languagesWaiting") : t(`result.${state}`),
    };
  });
}

/** The words the browser needs while it submits and when a press is refused (the composer's client part draws them). */
function messagesOf(t: Text): ComposerMessages {
  return {
    errors: {
      ...Object.fromEntries(MESSAGE_CODES.map((code) => [code, t(`errors.${code}`, { max: ALERT_TEXT_MAX })])),
      NOT_REACHED: t("running.notReached"),
      invalid: t("errors.invalid"),
    },
    running: {
      title: t("running.title"),
      lead: t("running.lead", { seconds: "{seconds}" }),
      leadUnknown: t("running.leadUnknown"),
      summary: t("running.summary", { done: "{done}", total: "{total}" }),
      lost: t("running.lost"),
      waiting: t("running.waiting"),
    },
    result: { translated: t("result.translated"), script_converted: t("result.script_converted"), fallback_en: t("result.fallback_en") },
  };
}

/** The running alert as residents read it: newest entry first, each with its time and where things stood, and the thread's valid-until (S05.01). */
function threadDigest(summary: ThreadSummary, t: Text): ThreadDigestView {
  return {
    title: t("thread.title"),
    lead: t("thread.lead"),
    validUntil: summary.validUntil === null ? "" : t("thread.validUntil", { time: formatTorontoDateTime(summary.validUntil) }),
    entries: summary.entries.map((entry) => ({
      key: entry.id,
      heading: t("thread.entry", { kind: t(`thread.kind.${entry.kind}`), time: formatTorontoDateTime(entry.webPublishedAt) }),
      phase: t(`phase.${entry.phase}`),
      text: entry.text,
    })),
  };
}

/** What an update changes about who the thread is for, against the audience of the entry that covers it now; both lines null when it changes nothing. */
function changeOfUpdate(
  thread: ThreadSummary | null | undefined,
  entryId: string,
  audience: Audience,
  plans: readonly BuildingFloorPlan[],
  audienceText: Text,
  t: Text,
): ChangeView & { same: string | null } {
  const covering = thread?.covering ?? null;
  if (covering === null || covering.id === entryId) return { alsoFor: null, noLongerFor: null, same: null };
  const lines = changeView(covering.audience, audience, plans, audienceText);
  return { ...lines, same: lines.alsoFor === null && lines.noLongerFor === null ? t("sameAudience") : null };
}

/** "Urdu, Pashto and Dari": the English names of the languages that fell back. */
function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const TITLES: Record<ComposerMode, { title: (t: Text) => string; lead: (t: Text) => string }> = {
  ack: { title: (t) => t("ackTitle"), lead: (t) => t("ackLead") },
  alert: { title: (t) => t("alertTitle"), lead: (t) => t("alertLead") },
  update: { title: (t) => t("updateTitle"), lead: (t) => t("updateLead") },
  promote: { title: (t) => t("promoteTitle"), lead: (t) => t("promoteLead") },
};

/** Where things stand: two choices, required. On an update none is carried over: a new update has none ticked (`checked` null), a saved one the author's. */
function phaseOf(t: Text, followUp: boolean, checked: string | null): NonNullable<DraftFormView["phase"]> {
  return {
    legend: t("phaseLegend"),
    items: (["problem", "in_progress"] as const).map((id) => ({ id, label: t(`phase.${id}`), checked: checked === id })),
    required: true,
    hint: followUp ? t("phaseRequired") : null,
  };
}

/** The composer for an entry as the server stores it. */
export function composerScreen(input: ComposerInput): ComposerScreen {
  const t = input.text ?? catalogText;
  const { state, mode } = input;
  const { entry, thread, attempt } = state;
  const ref: DraftRef = { alertId: thread.id, entryId: entry.id };
  const content = entry.content;
  const from = fromOfMode(mode);
  const followUp = isFollowUpMode(mode);
  const refQuery = new URLSearchParams({ alert: ref.alertId, entry: ref.entryId, from }).toString();
  const here = `${composerPage(from)}?${new URLSearchParams({ alert: ref.alertId, entry: ref.entryId }).toString()}`;
  const results = new Map<string, LanguageResult>();
  for (const translation of state.translations) results.set(translation.lang, translation.status as LanguageResult);
  // A running attempt shows each language as it settled; the frozen translations show once they exist.
  if (attempt?.state === "running" && entry.status === "draft") for (const [lang, result] of Object.entries(attempt.progress)) results.set(lang, result as LanguageResult);

  const status = entry.status === "draft" ? "draft" : entry.status === "pending_approval" ? "pending" : "locked";
  const ticked = new Set(content.types);
  const fallbackLangs = state.translations.filter((translation) => translation.status === "fallback_en").map((translation) => t(`languageNames.${translation.lang}`));

  const messages = messagesOf(t);

  const lastFailed = attempt?.state === "failed" && entry.status === "draft" && !input.saved ? attempt.outcome : null;
  const placeHref = `${PLACE_PAGE}?${refQuery}`;
  const audience: Audience = content.audience;
  // The aside's sentences are the audience pages' words; a `text` given for the layout tests puts its words in them too.
  const audienceText: Text = input.text ?? ((key, values) => englishText(`staff.audience.${key}`, values));
  const aside = asideOf(audience, input.plans, { href: placeHref, label: t("asideLink.place") }, audienceText);

  const screen: ComposerScreen = {
    mode,
    from,
    ref,
    title: TITLES[mode].title(t),
    lead: TITLES[mode].lead(t),
    firstReport: t("firstReport", { time: formatTorontoDateTime(thread.reportedAt) }),
    benchmark: t("benchmark"),
    status,
    ...(input.saved && status === "draft" ? { notice: t("saved") } : {}),
    ...(lastFailed ? { failure: messages.errors[lastFailed] ?? messages.errors.invalid } : {}),
    ...(status === "draft" && entry.returnedFor === "return" && entry.returnedNote ? { returned: { title: t("returned.title"), lead: t("returned.lead"), note: t("returned.note", { note: entry.returnedNote }) } } : {}),
    preview:
      input.preview === null
        ? null
        : {
            title: t("previewTitle"),
            lead: t("previewLead", { segments: input.preview.sms.segments, encoding: t(`previewEncoding.${input.preview.sms.encoding}`) }),
            lines: input.preview.sms.body.split("\n"),
            note: input.preview.nineOneOneFirst ? t("preview911First") : t("preview911Last"),
            segments: input.preview.sms.segments,
          },
    ...(followUp && input.thread ? { thread: threadDigest(input.thread, t) } : {}),
    languages: { title: t("languagesTitle"), lead: t("languagesLead"), rows: languageRows(results, t) },
    aside: {
      ...aside,
      link: { href: placeHref, label: t("asideLink.place") },
      groupsLink: { href: `${GROUPS_PAGE}?${refQuery}`, label: t("asideLink.groups") },
      channelsTitle: t("channelsTitle"),
      channels: [t("channelWeb"), t("channelSms")],
      ...(followUp ? { carried: t("carried"), change: changeOfUpdate(input.thread, entry.id, audience, input.plans, audienceText, t) } : {}),
    },
    actions: { label: t("actionsLabel"), save: t("save"), submit: t("submit") },
    // A running attempt always leaves the entry a draft (a "Try translation again" returns it to draft first).
    resume: attempt?.state === "running" && entry.status === "draft" ? { key: attempt.key, kind: attempt.kind, budgetMs: attempt.budgetMs, progress: { ...attempt.progress } } : null,
    lastAttemptKey: attempt?.key ?? null,
    messages,
    here,
  };

  if (status === "draft") {
    const valid = fieldsOfStoredInstant(content.validUntil);
    screen.draft = {
      text: { label: t("textLabel"), hint: t("textHint", { max: ALERT_TEXT_MAX }), value: content.text, max: ALERT_TEXT_MAX, counter: t("counter", { n: "{n}", max: ALERT_TEXT_MAX }) },
      types:
        mode === "alert"
          ? { legend: t("typesLegend"), building: typeChoices(BUILDING_TYPES, ticked), neighbourhood: typeChoices(NEIGHBOURHOOD_TYPES, ticked) }
          : null,
      typesSummary: content.types.map(typeName).join(", "),
      phase: mode === "alert" || followUp ? phaseOf(t, followUp, content.phase) : null,
      valid: {
        title: t("validTitle"),
        hint: t("validHint"),
        resolvedLabel: t("validResolved"),
        atLabel: t("validAt"),
        dateLabel: englishText("staff.time.dateLabel"),
        timeLabel: englishText("staff.time.timeLabel"),
        foldLegend: englishText("staff.time.foldLegend"),
        mode: content.validUntilMode ?? "at",
        fields: valid,
      },
    };
  } else if (status === "pending") {
    const n = fallbackLangs.length;
    screen.pending = {
      title: t("committed.title"),
      lead: t("committed.lead", { version: entry.version }),
      version: entry.version,
      contentHash: entry.contentHash ?? "",
      fallback:
        n > 0
          ? { summary: t("committed.fellBack", { n, total: FROZEN_LANGS.length, languages: joinWords(fallbackLangs) }), retry: t("committed.retry"), retryNote: t("committed.retryNote") }
          : null,
      allTranslated: n === 0 ? t("committed.allTranslated") : null,
      pullBack: { label: t("committed.pullBack"), note: t("committed.pullBackNote") },
      duplicate: entry.possibleDuplicateOf ? t("committed.duplicate") : null,
    };
  } else {
    screen.locked = entry.status === "approved" ? t("locked.approved") : entry.status === "discarded" ? t("locked.discarded") : t("locked.closed");
  }
  return screen;
}

export interface StartInput {
  mode: "update" | "promote";
  alertId: string;
  /** The id the new entry will take: made when the page is drawn, so that pressing Save twice makes one draft (`addUpdate`). */
  entryId: string;
  /** The thread the update adds to: the running alert shown above the form. */
  thread: ThreadSummary;
  /**
   * What the update starts from, taken from the entry that covers the thread (alerting's `updateStart(covering, now)`, which the page asks: this module is
   * drawn by the layout tests too and imports nothing of alerting but its types): the audience and types carried over, and the valid-until that defaults to the
   * previous entry's choice.
   */
  start: UpdateStart;
  plans: readonly BuildingFloorPlan[];
  /** The words of the screen; the layout tests give the longest labels of a language here. */
  text?: Text;
}

/**
 * An update whose draft is not made yet (S05.01, O-14 and O-13): the form of a draft with what the thread gives it carried over (who it is for, the types,
 * the languages, and a valid-until that defaults to the previous entry's choice: "until resolved" renews to 24 hours from now), a phase nobody has chosen
 * (it is required, so none is ticked) and no text; and, above it, the running alert as residents read it. Saving makes the draft and opens it on the same
 * composer (`composerScreen`), where who it is for can be changed and the update submitted. Nothing is made, and nothing is audited, until then.
 */
export function startScreen(input: StartInput): ComposerScreen {
  const t = input.text ?? catalogText;
  const { mode, start } = input;
  const ref: DraftRef = { alertId: input.alertId, entryId: input.entryId };
  const audienceText: Text = input.text ?? ((key, values) => englishText(`staff.audience.${key}`, values));
  const aside = asideOf(start.audience, input.plans, { href: "", label: "" }, audienceText);
  return {
    mode,
    from: fromOfMode(mode),
    ref,
    title: TITLES[mode].title(t),
    lead: TITLES[mode].lead(t),
    firstReport: t("firstReport", { time: formatTorontoDateTime(input.thread.thread.reportedAt) }),
    benchmark: "",
    status: "new",
    startNote: t("startNote"),
    thread: threadDigest(input.thread, t),
    preview: null,
    languages: { title: t("languagesTitle"), lead: t("languagesLead"), rows: languageRows(new Map(), t) },
    aside: {
      ...aside,
      // Nothing to link to until the draft exists: the pickers are opened from the saved draft.
      groupsLink: { href: "", label: "" },
      channelsTitle: t("channelsTitle"),
      channels: [t("channelWeb"), t("channelSms")],
      carried: t("carriedStart"),
      change: { alsoFor: null, noLongerFor: null, same: null },
    },
    actions: { label: t("actionsLabel"), save: t("save"), submit: t("submit") },
    resume: null,
    lastAttemptKey: null,
    messages: messagesOf(t),
    here: `${composerPage(fromOfMode(mode))}?${new URLSearchParams({ alert: input.alertId }).toString()}`,
    draft: {
      text: { label: t("textLabel"), hint: t("textHint", { max: ALERT_TEXT_MAX }), value: "", max: ALERT_TEXT_MAX, counter: t("counter", { n: "{n}", max: ALERT_TEXT_MAX }) },
      types: null,
      typesSummary: start.types.map(typeName).join(", "),
      phase: phaseOf(t, true, null),
      valid: {
        title: t("validTitle"),
        hint: t("validHint"),
        resolvedLabel: t("validResolved"),
        atLabel: t("validAt"),
        dateLabel: englishText("staff.time.dateLabel"),
        timeLabel: englishText("staff.time.timeLabel"),
        foldLegend: englishText("staff.time.foldLegend"),
        mode: start.validUntilMode,
        fields: fieldsOfStoredInstant(start.validUntil),
      },
    },
  };
}

/**
 * The screen for an entry that is not there, and the two a thread can give an update's start: it is closed ("This alert is already closed": nothing more can
 * be added, so no form and no "Add an update"), or it has nothing residents can read yet (its first entry waits for approval).
 */
export interface MissingComposer {
  kind: "missing" | "closed" | "unpublished";
  message: string;
  back: { href: string; label: string };
}

export function missingComposer(t: Text = catalogText): MissingComposer {
  return { kind: "missing", message: t("missing"), back: { href: "/staff", label: t("back") } };
}

export function closedUpdate(t: Text = catalogText): MissingComposer {
  return { kind: "closed", message: t("updateClosed"), back: { href: "/staff", label: t("back") } };
}

export function unpublishedUpdate(t: Text = catalogText): MissingComposer {
  return { kind: "unpublished", message: t("updateUnpublished"), back: { href: "/staff", label: t("back") } };
}
