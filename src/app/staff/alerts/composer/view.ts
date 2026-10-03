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
import type { EntryState } from "@/modules/alerting";
import type { RenderedSms } from "@/modules/messaging";
import type { BuildingFloorPlan } from "@/modules/places";
import { asideOf, type AsideView } from "../audience/view";
import { GROUPS_PAGE, PLACE_PAGE, type DraftRef } from "../audience/editAudience";
import { fieldsOfStoredInstant, type TimeFields } from "../timeField";
import { typeName } from "../typeNames";
import { formatTorontoDateTime } from "@/platform/clock";

export type Text = (key: string, values?: Record<string, string | number>) => string;

/** The words of this screen: `staff.compose.<key>` of the catalog. */
export const catalogText: Text = (key, values) => englishText(`staff.compose.${key}`, values);

export type ComposerMode = "ack" | "alert";

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
  phase: { legend: string; items: ChoiceView[] } | null;
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
  ref: DraftRef;
  title: string;
  lead: string;
  firstReport: string;
  benchmark: string;
  status: "draft" | "pending" | "locked";
  notice?: string;
  /** Why the last attempt failed, shown on the draft it left. */
  failure?: string;
  locked?: string;
  draft?: DraftFormView;
  pending?: PendingView;
  preview: PreviewView | null;
  languages: { title: string; lead: string; rows: LanguageRowView[] };
  aside: AsideView & { groupsLink: { href: string; label: string }; channelsTitle: string; channels: string[] };
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

/** "Urdu, Pashto and Dari": the English names of the languages that fell back. */
function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The composer for an entry as the server stores it. */
export function composerScreen(input: ComposerInput): ComposerScreen {
  const t = input.text ?? catalogText;
  const { state, mode } = input;
  const { entry, thread, attempt } = state;
  const ref: DraftRef = { alertId: thread.id, entryId: entry.id };
  const content = entry.content;
  const from = mode === "ack" ? "ack" : "compose";
  const refQuery = new URLSearchParams({ alert: ref.alertId, entry: ref.entryId, from }).toString();
  const here = `${mode === "ack" ? "/staff/alerts/ack" : "/staff/alerts/compose"}?${new URLSearchParams({ alert: ref.alertId, entry: ref.entryId }).toString()}`;
  const results = new Map<string, LanguageResult>();
  for (const translation of state.translations) results.set(translation.lang, translation.status as LanguageResult);
  // A running attempt shows each language as it settled; the frozen translations show once they exist.
  if (attempt?.state === "running" && entry.status === "draft") for (const [lang, result] of Object.entries(attempt.progress)) results.set(lang, result as LanguageResult);

  const status = entry.status === "draft" ? "draft" : entry.status === "pending_approval" ? "pending" : "locked";
  const ticked = new Set(content.types);
  const fallbackLangs = state.translations.filter((translation) => translation.status === "fallback_en").map((translation) => t(`languageNames.${translation.lang}`));

  const messages: ComposerMessages = {
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

  const lastFailed = attempt?.state === "failed" && entry.status === "draft" && !input.saved ? attempt.outcome : null;
  const placeHref = `${PLACE_PAGE}?${refQuery}`;
  const audience: Audience = content.audience;
  // The aside's sentences are the audience pages' words; a `text` given for the layout tests puts its words in them too.
  const audienceText: Text = input.text ?? ((key, values) => englishText(`staff.audience.${key}`, values));
  const aside = asideOf(audience, input.plans, { href: placeHref, label: t("asideLink.place") }, audienceText);

  const screen: ComposerScreen = {
    mode,
    ref,
    title: mode === "ack" ? t("ackTitle") : t("alertTitle"),
    lead: mode === "ack" ? t("ackLead") : t("alertLead"),
    firstReport: t("firstReport", { time: formatTorontoDateTime(thread.reportedAt) }),
    benchmark: t("benchmark"),
    status,
    ...(input.saved && status === "draft" ? { notice: t("saved") } : {}),
    ...(lastFailed ? { failure: messages.errors[lastFailed] ?? messages.errors.invalid } : {}),
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
    languages: { title: t("languagesTitle"), lead: t("languagesLead"), rows: languageRows(results, t) },
    aside: {
      ...aside,
      link: { href: placeHref, label: t("asideLink.place") },
      groupsLink: { href: `${GROUPS_PAGE}?${refQuery}`, label: t("asideLink.groups") },
      channelsTitle: t("channelsTitle"),
      channels: [t("channelWeb"), t("channelSms")],
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
      phase:
        mode === "alert"
          ? { legend: t("phaseLegend"), items: (["problem", "in_progress"] as const).map((id) => ({ id, label: t(`phase.${id}`), checked: content.phase === id })) }
          : null,
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

/** The screen for an entry that is not there. */
export interface MissingComposer {
  kind: "missing";
  message: string;
  back: { href: string; label: string };
}

export function missingComposer(t: Text = catalogText): MissingComposer {
  return { kind: "missing", message: t("missing"), back: { href: "/staff", label: t("back") } };
}
