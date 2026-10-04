// The sending progress of an entry (S06.09, O-06): what became of the texts of one approved alert entry, per language, in the words a Coordinator reads,
// and why a text that did not arrive did not. Pure: no I/O, no clock. Counts, languages and codes only: a delivery row holds no phone number and no
// number is read here.
import type { DeliveryState } from "./deliveryState";

/**
 * The counts of one language (or of all of them). Every delivery of the entry is in exactly one:
 *  - `waiting`: `queued`, or `claimed` and not handed to the provider yet;
 *  - `inFlight`: handed to the provider and without a final answer: `claimed` with `handed_off_at` set (the one text a pause let go during an open
 *    hand-off is one of these) plus `submitted`;
 *  - `delivered`, `undelivered`, `failed`, `unknown`: the state of the row;
 *  - `cancelled`: `cancelled` (a correction, a withdrawal, a discard or a close stopped it before it went);
 *  - `skipped`: `skipped` (the recipient left, or it was too late or unsendable at the hand-off) and `skipped_env` (a log-mode environment): the text never
 *    went to the provider, and nobody withdrew it. The Hub reads it apart from "cancelled", only when there is one.
 */
export interface ProgressCounts {
  waiting: number;
  inFlight: number;
  delivered: number;
  undelivered: number;
  failed: number;
  unknown: number;
  cancelled: number;
  skipped: number;
}

export const PROGRESS_COUNT_KEYS = ["waiting", "inFlight", "delivered", "undelivered", "failed", "unknown", "cancelled", "skipped"] as const satisfies readonly (keyof ProgressCounts)[];

export const emptyCounts = (): ProgressCounts => ({ waiting: 0, inFlight: 0, delivered: 0, undelivered: 0, failed: 0, unknown: 0, cancelled: 0, skipped: 0 });

export interface LanguageProgress extends ProgressCounts {
  lang: string;
}

export interface EntryProgress {
  /** One row per language that has a text, in the order of the language code. */
  languages: LanguageProgress[];
  /** The sum over the languages. */
  total: ProgressCounts;
  /** The entry's texts, all states: the sum of `total`. */
  texts: number;
  /** The entry's rows with `handed_off_at` set, whatever their state is now: the `n` of the paused sentence (`handedOffLine(n)`). */
  handedOff: number;
}

export const sumOf = (counts: ProgressCounts): number => PROGRESS_COUNT_KEYS.reduce((sum, key) => sum + counts[key], 0);

/** The totals of a list of languages. */
export function totalOf(languages: readonly ProgressCounts[]): ProgressCounts {
  const total = emptyCounts();
  for (const language of languages) for (const key of PROGRESS_COUNT_KEYS) total[key] += language[key];
  return total;
}

/** The bucket of a delivery row, from its state and whether it was handed to the provider. The table that counts them in SQL says the same. */
export function bucketOf(state: DeliveryState, handedOff: boolean): keyof ProgressCounts {
  switch (state) {
    case "queued":
      return "waiting";
    case "claimed":
      return handedOff ? "inFlight" : "waiting";
    case "submitted":
      return "inFlight";
    case "delivered":
    case "undelivered":
    case "failed":
    case "unknown":
    case "cancelled":
      return state;
    case "skipped":
    case "skipped_env":
      return "skipped";
  }
}

/** The progress of a list of rows (state, language, handed off or not). The database does this count; this is its definition, and the tests compare the two. */
export function progressOf(rows: readonly { lang: string; state: DeliveryState; handedOff: boolean }[]): EntryProgress {
  const byLanguage = new Map<string, LanguageProgress>();
  for (const row of rows) {
    const language = byLanguage.get(row.lang) ?? { lang: row.lang, ...emptyCounts() };
    language[bucketOf(row.state, row.handedOff)] += 1;
    byLanguage.set(row.lang, language);
  }
  const languages = [...byLanguage.values()].sort((a, b) => (a.lang < b.lang ? -1 : a.lang > b.lang ? 1 : 0));
  return { languages, total: totalOf(languages), texts: rows.length, handedOff: rows.filter((row) => row.handedOff).length };
}

/** The states a Coordinator can open a list of: a text that did not arrive, or whose outcome is not known. */
export const PROBLEM_STATES = ["failed", "undelivered", "unknown"] as const satisfies readonly DeliveryState[];
export type ProblemState = (typeof PROBLEM_STATES)[number];

export const isProblemState = (value: unknown): value is ProblemState => typeof value === "string" && (PROBLEM_STATES as readonly string[]).includes(value);

/**
 * Why a text did not arrive, as a code the Hub puts in words (its catalog has one sentence for each, `staff.sending.meaning.<code>`).
 *  - `not_in_service`: the number is not in service or cannot be reached by text ("Number not in service");
 *  - `invalid_number`: the number is not a valid phone number;
 *  - `landline`: a landline, or a number that cannot receive text messages;
 *  - `phone_off`: the phone was off or out of reach when the carrier tried;
 *  - `opted_out`: the person replied STOP, so no more texts can go to them;
 *  - `blocked`: the carrier or the phone blocked or filtered the text;
 *  - `sender_not_ready`: the CVH's own sending number, or the account, is not allowed to send there (IT's to fix);
 *  - `provider_busy`: the provider's queue was full and the text was dropped;
 *  - `carrier_error`: the carrier reported an error with no detail;
 *  - `other_code`: the provider reported a code this list does not know (the code is shown);
 *  - `retries_exhausted`: the provider could not be reached for it, three times;
 *  - `no_reason`: the provider gave no reason for a failure;
 *  - `undelivered_no_reason`: the carrier did not deliver it and gave no reason;
 *  - `unclear`: the outcome is not known and the text was never re-sent ("Outcome unclear; not re-sent").
 */
export const PROBLEM_MEANINGS = [
  "not_in_service",
  "invalid_number",
  "landline",
  "phone_off",
  "opted_out",
  "blocked",
  "sender_not_ready",
  "provider_busy",
  "carrier_error",
  "other_code",
  "retries_exhausted",
  "no_reason",
  "undelivered_no_reason",
  "unclear",
] as const;
export type ProblemMeaning = (typeof PROBLEM_MEANINGS)[number];

/** Twilio's error codes the Hub says in words (https://www.twilio.com/docs/api/errors). A code not listed is `other_code`. */
const MEANING_OF_CODE: ReadonlyMap<number, ProblemMeaning> = new Map<number, ProblemMeaning>([
  [30005, "not_in_service"],
  [21612, "not_in_service"],
  [21211, "invalid_number"],
  [21214, "invalid_number"],
  [21217, "invalid_number"],
  [30006, "landline"],
  [21614, "landline"],
  [30003, "phone_off"],
  [21610, "opted_out"],
  [30004, "blocked"],
  [30007, "blocked"],
  [30032, "sender_not_ready"],
  [30034, "sender_not_ready"],
  [30002, "sender_not_ready"],
  [21408, "sender_not_ready"],
  [21606, "sender_not_ready"],
  [30001, "provider_busy"],
  [20429, "provider_busy"],
  [30008, "carrier_error"],
]);

/** The attempts after which a text that was not accepted is given up on (the sender's retry limit). */
const RETRY_LIMIT = 3;

export interface ProblemFacts {
  state: ProblemState;
  providerErrorCode: number | null;
  attempts: number;
}

/** What a text that did not arrive, or whose outcome is unknown, is shown as: the code of its meaning, and the provider's code when the meaning is not a known one. */
export function problemMeaning(facts: ProblemFacts): { meaning: ProblemMeaning; code: number | null } {
  if (facts.state === "unknown") return { meaning: "unclear", code: null };
  const code = facts.providerErrorCode;
  if (code !== null) {
    const known = MEANING_OF_CODE.get(code);
    return known === undefined ? { meaning: "other_code", code } : { meaning: known, code: null };
  }
  if (facts.state === "undelivered") return { meaning: "undelivered_no_reason", code: null };
  return { meaning: facts.attempts >= RETRY_LIMIT ? "retries_exhausted" : "no_reason", code: null };
}

/** One text that did not arrive, as the list shows it: no number, no body, only what it was and why. */
export interface ProblemText {
  /** The delivery's id. */
  id: string;
  /** A short reference to show instead of the id (its last six characters): what a Coordinator reads out to IT. */
  reference: string;
  lang: string;
  state: ProblemState;
  meaning: ProblemMeaning;
  /** The provider's error code when `meaning` is `other_code`, otherwise null. */
  code: number | null;
  /** When the state was last changed. */
  at: Date;
}

/** A text's short reference: the last six characters of its id (uuid v7 ids end in random bits). */
export const referenceOf = (id: string): string => id.replaceAll("-", "").slice(-6);
