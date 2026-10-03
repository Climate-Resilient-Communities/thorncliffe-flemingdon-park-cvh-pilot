// What translating an alert's English text produces and records (S04.02, AD-10). Pure: the types of the cache and of the
// report a translation leaves, and the estimate a call that never answered is counted by.
import type { LangCode } from "@/contracts/lang";
import { LANG_CODES } from "@/contracts/lang";
import type { AlertCheckFailure } from "./alertChecks";
import { TRANSLATE_SPEND_KIND } from "./questionTranslation";

/** Every language an alert is translated into: all launch languages but English (the source); zh-Hant is converted from zh. */
export const ALERT_TARGET_LANGS = LANG_CODES.filter((lang): lang is Exclude<LangCode, "en"> => lang !== "en");

/** The kind of usage an alert's translation is counted under in spend_event (the same as a question's: both are translations). */
export const ALERT_SPEND_KIND = TRANSLATE_SPEND_KIND;

/**
 * The most a model is asked to write for one alert: an alert is at most 600 characters of English, and Indic and Arabic
 * scripts take several tokens to a word. Questions use the adapter's much smaller default.
 */
export const ALERT_MAX_OUTPUT_TOKENS = 2048;

/** What the adapter's instructions cost, when a call is counted by estimate: about 500 characters at three bytes to a token. */
export const INSTRUCTION_TOKENS_ESTIMATE = 170;

/**
 * What a call is counted as when the vendor did not say (it was cancelled before it answered, or answered without usage):
 * the instructions and the text at about three bytes to a token, and an answer taken to be twice that, at most what the
 * model was allowed to write. An estimate, recorded as one.
 */
export function estimateAlertCallTokens(english: string): number {
  const text = Math.ceil(new TextEncoder().encode(english).length / 3);
  return INSTRUCTION_TOKENS_ESTIMATE + text + Math.min(2 * text, ALERT_MAX_OUTPUT_TOKENS);
}

/** Every part of the cache key (AD-10). `openccVersion` and `openccConfig` are "" for every language but zh-Hant. */
export interface TranslationCacheKey {
  sourceHash: string;
  lang: LangCode;
  /** The model that wrote the text; for zh-Hant, the model that wrote the zh text it was converted from. */
  modelId: string;
  promptVersion: string;
  checkVersion: string;
  openccVersion: string;
  openccConfig: string;
}

/** A passing result as the cache keeps it. Failures are never cached, so there is no status for one. */
export interface CachedTranslation {
  body: string;
  status: "ok" | "script_converted";
  /** zh-Hant only: the sha256 of the zh text that was converted. */
  fromTextHash: string | null;
}

/**
 * How one attempt (a route position) ended: `cached` and `passed` gave the language its text; the rest did not, and the next
 * model ran: the attempt's own timeout, the route deadline or the caller's cancel aborted it, the vendor failed, or the
 * output failed a check (AlertCheckFailure).
 */
export type AttemptResult =
  | "cached"
  | "passed"
  | "timed_out"
  | "deadline"
  | "cancelled"
  | "failed"
  | AlertCheckFailure;

export interface AttemptOutcome {
  position: number;
  model: string;
  result: AttemptResult;
  /** How long the attempt took in milliseconds (0 for a cache hit). */
  ms: number;
}

/** What happened to one language: codes and numbers only, never text. */
export interface LanguageOutcome {
  lang: Exclude<LangCode, "en">;
  status: "ok" | "script_converted" | "fallback_en";
  /** Why the language has no translation, when it has none: no route configured, every model in the route failed (or the route deadline came), the caller cancelled, zh was unavailable, or the conversion failed. */
  fallbackReason: "no_route" | "route_exhausted" | "cancelled" | "zh_unavailable" | "conversion_failed" | null;
  attempts: AttemptOutcome[];
  /** From the start of this language's translation to its result, in milliseconds. */
  ms: number;
}
