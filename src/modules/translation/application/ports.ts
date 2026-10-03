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

/** Why a translation call failed: a code only. */
export class TranslateError extends Error {
  override name = "TranslateError";
  readonly code: "failed" | "aborted";
  constructor(code: "failed" | "aborted") {
    super(code === "aborted" ? "The translation was cancelled" : "The translation failed");
    this.code = code;
  }
}
