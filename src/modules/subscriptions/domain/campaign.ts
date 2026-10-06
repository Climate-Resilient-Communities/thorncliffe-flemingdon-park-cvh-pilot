// The end-of-pilot re-consent campaign's rules (S09.07; E09 definitions "Campaign", "Re-consent prompt", "Receiving subscriber"; spine AD-9 D-7). Pure: no I/O.
//
// A campaign asks every `active` subscriber, in their language, whether to keep getting texts after the pilot. The text is a frozen catalog string
// (`smsTexts.reconsent`, reviewed before the pilot) with the deadline filled in; the deadline is the end of the Toronto day 30 days after the start
// (`RECONSENT_DAYS`), the same rule the database checks (`campaign_guard()`), so S09.08's purge deletes everyone who did not say YES "when we said".
// It is rehearsed on the drill roster first (S06.05: staff phones only), with exactly the text subscribers will get.
import { LAUNCH_CODES, type LaunchCode } from "../../../i18n/languages";
import { smsDateWords } from "../../../i18n/residentTexts";

/** How long subscribers have to reply YES: the deadline is the end of the Toronto day this many days after the start. */
export const RECONSENT_DAYS = 30;

/** The purpose of a campaign text (the outbox's key `campaign:{campaign}:reconsent:{recipient}`) and the kind of its prompt (`sms_prompt.kind`). */
export const RECONSENT_PURPOSE = "reconsent";
export const RECONSENT_PROMPT_KIND = "reconsent";

/** The day a campaign started today would end (`YYYY-MM-DD`), in Toronto: today there plus RECONSENT_DAYS. */
export function deadlineDateOf(now: Date): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + RECONSENT_DAYS);
  return day.toISOString().slice(0, 10);
}

/** Whether a value is a calendar day written `YYYY-MM-DD` (what the confirmation form carries back). */
export function isDeadlineDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

/**
 * The deadline as the campaign text writes it: the day and the month in the language's own way, on the Gregorian calendar, with no year (it is at most 31
 * days away). The words are the catalog's `smsDate` (src/i18n/residentTexts.ts), never the runtime's `Intl`: its data differ between Node versions (Tamil
 * puts the month first in one and the day first in another), and the frozen text must be the one reviewed and measured at one segment on every runtime.
 * The catalog abbreviates the month where a text fits one message (70 characters in UCS-2) only that way (Gujarati, Tamil, Greek, Bengali), and French
 * writes August "aout", the 1990 spelling every reader knows ("û" is not in GSM-7, and that one letter would make the whole text three messages).
 */
export function deadlineInText(deadlineDate: string, lang: LaunchCode): string {
  const words = smsDateWords(lang);
  const [, month, day] = deadlineDate.split("-").map(Number);
  const dayText = String(day).replace(/[0-9]/g, (digit) => words.digits[Number(digit)]!);
  // One pass, so a month name that happens to contain "{day}" (none does) could not be rewritten.
  return words.dayMonth.replace(/\{(day|month)\}/g, (_, part: string) => (part === "day" ? dayText : words.months[month! - 1]!));
}

/** The deadline as the Hub's staff read it: "Thursday, November 5, 2026". */
export function deadlineForStaff(deadlineDate: string): string {
  return new Intl.DateTimeFormat("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" }).format(
    new Date(`${deadlineDate}T12:00:00Z`),
  );
}

/** One language's frozen campaign text: what goes out, byte for byte, and its segments. */
export interface FrozenCampaignText {
  body: string;
  segments: number;
}

/** The campaign's frozen texts, one per launch language (the database refuses a campaign that lacks one). */
export type CampaignTexts = Record<LaunchCode, FrozenCampaignText>;

/** Builds the frozen texts from a renderer of one language's text (the catalog string with `{date}` filled, normalised and counted). */
export function campaignTexts(deadlineDate: string, render: (lang: LaunchCode, date: string) => FrozenCampaignText): CampaignTexts {
  return Object.fromEntries(LAUNCH_CODES.map((lang) => [lang, render(lang, deadlineInText(deadlineDate, lang))])) as CampaignTexts;
}

/** A cost estimate in whole cents per text, as the outbox stores it (S06.08): the segments at the price, rounded up. */
export const textCostCents = (segments: number, pricePerSegmentCents: number): number => Math.ceil(segments * pricePerSegmentCents);

/** The subscribers a campaign would ask, by language, with the estimate of their texts. */
export interface CampaignEstimate {
  byLanguage: { lang: LaunchCode; subscribers: number; costCents: number }[];
  subscribers: number;
  costCents: number;
}

/** What starting now would text: one campaign text per subscriber in their language, at the frozen text's segments. */
export function estimateCampaign(counts: Partial<Record<LaunchCode, number>>, texts: CampaignTexts, pricePerSegmentCents: number): CampaignEstimate {
  const byLanguage = LAUNCH_CODES.filter((lang) => (counts[lang] ?? 0) > 0).map((lang) => {
    const subscribers = counts[lang] ?? 0;
    return { lang, subscribers, costCents: subscribers * textCostCents(texts[lang].segments, pricePerSegmentCents) };
  });
  return {
    byLanguage,
    subscribers: byLanguage.reduce((sum, row) => sum + row.subscribers, 0),
    costCents: byLanguage.reduce((sum, row) => sum + row.costCents, 0),
  };
}

/**
 * Why a campaign action changed nothing (each is also the audit reason's source and the words the Admin reads):
 *  - `key_invalid`: the form's idempotency key is not one (a page that was not rendered by the Hub);
 *  - `deadline_changed`: the Toronto day turned since the Admin saw the deadline (the form carries the one they saw);
 *  - `terms_unavailable`: no terms are published, so there is nothing to re-consent to;
 *  - `rehearsal_needed`: the campaign starts only after a rehearsal on the drill roster; `roster_empty`: a rehearsal needs a phone on the roster to reach;
 *  - `already_started`: there is a campaign already (one real campaign in the pilot);
 *  - `not_confirmed`: the Admin did not tick that they checked the deadline, the numbers and the cost;
 *  - `not_ended`: sign-ups are reopened only after the campaign ended; `already_reopened`: they are open already; `no_campaign`: there is none.
 */
export const CAMPAIGN_REFUSALS = [
  "key_invalid",
  "deadline_changed",
  "terms_unavailable",
  "rehearsal_needed",
  "roster_empty",
  "already_started",
  "not_confirmed",
  "not_ended",
  "already_reopened",
  "no_campaign",
] as const;
export type CampaignRefusal = (typeof CAMPAIGN_REFUSALS)[number];

/** A campaign's state (`campaign.state`): `started -> ended`; `cancelled` only by the owner. */
export type CampaignState = "started" | "ended" | "cancelled";
