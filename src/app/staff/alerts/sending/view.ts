// What the sending progress shows (S06.09, UX-DR16 O-06): the view model, with every text already resolved from the English catalog, so the components that draw
// it know none of it and the layout tests can put the longest label in every place. Pure: no I/O. It is counts, languages and the meaning of a text that did
// not arrive: never a phone number, a body or a name.
//
// The progress block is drawn in two places from the same model: the published confirmation (O-06, `PublishedMain`) and the alert's staff view
// (`/staff/alerts/sending`). Per language: waiting, in flight (handed to the provider), delivered, undelivered, failed, unknown and cancelled, and skipped
// when there is one. While texts are paused and the entry still has texts waiting it says how many were already handed to the provider and cannot be
// recalled, in the pause screen's own words (`handedOffLine`).
import { englishText } from "@/i18n/text";
import type { EntryProgress, ProblemMeaning, ProblemState, ProblemText, ProgressCounts } from "@/modules/messaging";
import { formatTorontoDateTime } from "@/platform/clock";
import { sendingHref, sendingTextsHref } from "../pages";
import { handedOffLine } from "../../texts/view";

// Type imports only from messaging: the layout tests and the screenshots import this file in Node and the components in the browser, and neither may pull in
// the module's database code. The two lists below are the module's own (`PROGRESS_COUNT_KEYS`, `PROBLEM_STATES`); view.test.ts compares them.
export const COUNT_ORDER = ["waiting", "inFlight", "delivered", "undelivered", "failed", "unknown", "cancelled", "skipped"] as const satisfies readonly (keyof ProgressCounts)[];
export const PROBLEM_ORDER = ["failed", "undelivered", "unknown"] as const satisfies readonly ProblemState[];

export type Text = (key: string, values?: Record<string, string | number>) => string;

/** The words of this screen: `staff.sending.<key>` of the catalog. */
export const sendingText: Text = (key, values) => englishText(`staff.sending.${key}`, values);

/** How often the progress reloads itself while texts are going out, in seconds (S06.09). */
export const REFRESH_SECONDS = 15;

/** The language of a text in words: English, or the composer's name for it (zh-Hant and the others). */
export function languageLabel(lang: string, t: Text = sendingText, compose: Text = (key, values) => englishText(`staff.compose.${key}`, values)): string {
  return lang === "en" ? t("english") : compose(`languageNames.${lang}`);
}

export interface CountView {
  id: keyof ProgressCounts;
  n: number;
  /** "Waiting: 3". */
  text: string;
}

export interface LanguageProgressView {
  /** The language code; `all` for the row of the totals. */
  lang: string;
  label: string;
  counts: CountView[];
}

export interface ProblemLinkView {
  state: ProblemState;
  n: number;
  label: string;
  href: string;
}

export interface SendingProgressView {
  title: string;
  lead: string;
  /** "12 texts in all". */
  summary: string;
  /** Said instead of the counts when the entry has no text at all. */
  none: string | null;
  /** One row per language, in the order of the language code. */
  languages: LanguageProgressView[];
  /** The totals, when there is more than one language. */
  total: LanguageProgressView | null;
  /** "{n} texts were already handed to the provider and cannot be recalled": only while texts are paused and a text of the entry still waits. */
  handedOff: string | null;
  /** The lists of the texts that did not arrive, for each state that has some. Null when none has. */
  problems: { title: string; lead: string; links: ProblemLinkView[] } | null;
  legend: { title: string; items: string[] };
  /** Whether the page reloads itself every `REFRESH_SECONDS`: while a text waits or is in flight. */
  live: boolean;
  refresh: { seconds: number; note: string };
}

const countsOf = (counts: ProgressCounts, showSkipped: boolean, t: Text): CountView[] =>
  COUNT_ORDER.filter((id) => id !== "skipped" || showSkipped).map((id) => ({ id, n: counts[id], text: t("count", { label: t(`counts.${id}`), n: counts[id] }) }));

/** The progress of an entry as a page draws it: the counts, or a note that they could not be read (the rest of the page is still drawn). */
export type SendingBlock = { kind: "progress"; view: SendingProgressView } | { kind: "unavailable"; note: string };

export interface SendingInput {
  ref: { alertId: string; entryId: string };
  progress: EntryProgress;
  /** Whether texts are paused now (S06.06). */
  paused: boolean;
  text?: Text;
  compose?: Text;
}

/** The progress block of an approved entry. */
export function sendingProgressView(input: SendingInput): SendingProgressView {
  const t = input.text ?? sendingText;
  const { progress } = input;
  const showSkipped = progress.total.skipped > 0;
  const live = progress.total.waiting + progress.total.inFlight > 0;
  const links: ProblemLinkView[] = PROBLEM_ORDER.filter((state) => progress.total[state] > 0).map((state) => ({
    state,
    n: progress.total[state],
    label: t(`problems.${state}`, { n: progress.total[state] }),
    href: sendingTextsHref(input.ref, state),
  }));
  return {
    title: t("title"),
    lead: t("lead"),
    summary: progress.texts === 1 ? t("summaryOne") : t("summary", { n: progress.texts }),
    none: progress.texts === 0 ? t("none") : null,
    languages: progress.languages.map((language) => ({ lang: language.lang, label: languageLabel(language.lang, t, input.compose), counts: countsOf(language, showSkipped, t) })),
    total: progress.languages.length > 1 ? { lang: "all", label: t("allLanguages"), counts: countsOf(progress.total, showSkipped, t) } : null,
    // The pause screen's sentence, with this entry's own count of texts handed to the provider (rows with `handed_off_at`), only while the entry still has texts waiting.
    handedOff: input.paused && progress.total.waiting > 0 ? handedOffLine(progress.handedOff) : null,
    problems: links.length > 0 ? { title: t("problems.title"), lead: t("problems.lead"), links } : null,
    legend: { title: t("legend.title"), items: COUNT_ORDER.filter((id) => id !== "skipped" || showSkipped).map((id) => t(`legend.${id}`)) },
    live,
    refresh: { seconds: REFRESH_SECONDS, note: live ? t("refresh") : t("refreshDone") },
  };
}

/** What a block says when the progress could not be read: the rest of the screen is still drawn. */
export const unavailableNote = (t: Text = sendingText): string => t("unavailable");

// --- the list of the texts that did not arrive ---------------------------------------------------------------------------------------------------------

/** "Resend" on one text (S09.02), shown to an Admin: the form carries the status the Admin saw, and for an `unknown` text the warning they must confirm. */
export interface ResendControlView {
  entryId: string;
  deliveryId: string;
  /** The status the Admin saw: the server refuses the resend if the text is another status by then. */
  seen: ProblemState;
  label: string;
  ariaLabel: string;
  sending: string;
  /** "This text may already have arrived; resending may send it twice": an `unknown` text only. */
  confirm: string | null;
}

export interface ProblemTextView {
  key: string;
  /** "Text 3f9a1c · Urdu · Oct 5, 2026, 2:15 p.m." */
  line: string;
  /** The meaning in plain words: "Number not in service", "Outcome unclear; not re-sent". */
  meaning: string;
  meaningId: ProblemMeaning;
  /** What the text's chain says (S09.02): "Resend 1 of 2.", "Already resent: ...", "Resent twice already, ...", or null. */
  note: string | null;
  /** The Admin's "Resend", or null for anyone else and for a text that cannot be resent. */
  resend: ResendControlView | null;
}

/** "Resend the failed and undelivered texts in Urdu" (S09.02), shown to an Admin on the lists of failed and undelivered texts. */
export interface ResendAllView {
  entryId: string;
  lang: string;
  label: string;
  hint: string;
  sending: string;
}

export interface ProblemListView {
  state: ProblemState;
  title: string;
  lead: string;
  none: string | null;
  items: ProblemTextView[];
  more: string | null;
  /** What a resend is, said once above the buttons; null for anyone who has none. */
  resendIntro: { title: string; lead: string } | null;
  /** The Admin's way to resend a language's failed and undelivered texts in one press; empty for anyone else and on the list of unknown texts. */
  resendAll: ResendAllView[];
  back: { href: string; label: string };
}

/** The meanings that say the number cannot receive texts, so no resend is offered. messaging's `UNRECEIVABLE_MEANINGS` is the same list (view.test.ts compares them). */
export const UNRECEIVABLE_MEANING_IDS = ["not_in_service", "invalid_number", "landline", "opted_out"] as const satisfies readonly ProblemMeaning[];
/** A chain has at most this many resends. messaging's `RESEND_LIMIT` is the same number (view.test.ts compares them). */
export const RESEND_MOST = 2;

const resendNote = (text: ProblemText, t: Text): string | null => {
  if (text.resent) return t("resend.note.resent");
  if ((UNRECEIVABLE_MEANING_IDS as readonly string[]).includes(text.meaning)) return t("resend.note.cannot");
  if (text.resends >= RESEND_MOST) return t("resend.note.limit");
  return text.resendN !== null ? t("resend.note.resend", { n: text.resendN }) : null;
};

const canBeResent = (text: ProblemText): boolean =>
  !text.resent && text.resends < RESEND_MOST && !(UNRECEIVABLE_MEANING_IDS as readonly string[]).includes(text.meaning);

export const meaningText = (meaning: ProblemMeaning, code: number | null, t: Text = sendingText): string => t(`meaning.${meaning}`, { code: code ?? "" });

/** The list of an entry's texts in one state, each with its meaning and no number. */
export function problemListView(input: {
  ref: { alertId: string; entryId: string };
  state: ProblemState;
  texts: readonly ProblemText[];
  more: boolean;
  limit: number;
  text?: Text;
  compose?: Text;
  /** Whether the viewer is an Admin, who may resend (`delivery.resend`); the buttons are drawn for no one else. */
  canResend?: boolean;
  /** The languages that have a failed or undelivered text to resend, for "resend all" (the list shows only the most recent texts). */
  resendLanguages?: readonly string[];
}): ProblemListView {
  const t = input.text ?? sendingText;
  const canResend = input.canResend === true;
  const forms: ResendAllView[] =
    canResend && input.state !== "unknown"
      ? (input.resendLanguages ?? []).map((lang) => {
          const language = languageLabel(lang, t, input.compose);
          return { entryId: input.ref.entryId, lang, label: t("resend.all", { language }), hint: t("resend.allHint", { language }), sending: t("resend.sending") };
        })
      : [];
  const items: ProblemTextView[] = input.texts.map((text) => ({
    key: text.id,
    line: t("list.item", { ref: text.reference, language: languageLabel(text.lang, t, input.compose), when: formatTorontoDateTime(text.at) }),
    meaning: meaningText(text.meaning, text.code, t),
    meaningId: text.meaning,
    note: resendNote(text, t),
    resend:
      canResend && canBeResent(text)
        ? {
            entryId: input.ref.entryId,
            deliveryId: text.id,
            seen: text.state,
            label: t("resend.one"),
            ariaLabel: t("resend.oneFor", { ref: text.reference }),
            sending: t("resend.sending"),
            confirm: text.state === "unknown" ? t("resend.confirm") : null,
          }
        : null,
  }));
  return {
    state: input.state,
    title: t(`list.title.${input.state}`),
    lead: t("list.lead"),
    none: input.texts.length === 0 ? t("list.none") : null,
    items,
    more: input.more ? t("list.more", { n: input.limit }) : null,
    resendIntro: forms.length > 0 || items.some((item) => item.resend !== null) ? { title: t("resend.title"), lead: t("resend.lead") } : null,
    resendAll: forms,
    back: { href: sendingHref(input.ref), label: t("list.back") },
  };
}
