// The translation module's port (AD-10): the only way the app reaches a translation model. Cohere in production
// (adapters/cohereTranslator.ts); a fake in every test. S03.05 creates it for the translated-question leg of search; E04
// adds the alert routes, the cache and the per-language checks for alerts on top of the same port.
import type { LangCode } from "@/contracts/lang";

export interface TranslateRequest {
  text: string;
  /** The language of the text, or null when the model has to tell (romanized, mixed, or ambiguous Arabic-script text). */
  from: LangCode | null;
  to: LangCode;
  /** The model id, from config (a route), never chosen by the adapter. */
  model: string;
  signal: AbortSignal;
  /** The most the model may write, when the text is longer than a question (an alert, S04.02); the adapter's default for a question when absent. */
  maxOutputTokens?: number;
}

export interface Translation {
  /** The model's output as it came back (the caller normalises and checks it). */
  text: string;
  /** The tokens the vendor billed for the request and the answer, or null when it did not say. */
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * A translation model. Throws TranslateError, never an error that holds the request: adapters wrap the vendor's failures
 * and drop their bodies, which may echo the text (AD-3). Vendor language codes and prompts stay in the adapter (AD-20).
 */
export interface Translator {
  translate(request: TranslateRequest): Promise<Translation>;
}

/**
 * Why a translation call failed, as the adapter classified the vendor's error: `quota` (past the vendor's limit for the
 * model, in practice the monthly one), `rate_limited` (a transient limit), `unavailable` (5xx or the network), `other`, or
 * `aborted` (the caller's signal cancelled it). Only the class leaves the adapter, never the vendor's text.
 */
export type TranslateErrorCode = "quota" | "rate_limited" | "unavailable" | "other" | "aborted";

/** Whether a second model may be tried after this failure: the first model's limit, not the request, is what failed. */
export function isLimitFailure(code: TranslateErrorCode): boolean {
  return code === "quota" || code === "rate_limited";
}

/** Why a translation call failed: a code only. */
export class TranslateError extends Error {
  override name = "TranslateError";
  readonly code: TranslateErrorCode;
  constructor(code: TranslateErrorCode) {
    super(code === "aborted" ? "The translation was cancelled" : `The translation failed (${code})`);
    this.code = code;
  }
}
