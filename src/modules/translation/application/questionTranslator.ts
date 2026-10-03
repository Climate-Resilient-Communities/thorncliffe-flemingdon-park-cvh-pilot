// A resident's question in English, for the translated-question leg of search (S03.05, AD-10, AD-11, AD-3).
//
// The model comes from `search_question_route` (config); the translation is checked (English, not an answer) before it
// is used. Nothing is cached: a question and its translation exist only for the length of the request, in variables,
// and every error that leaves here is a QuestionTranslationError holding a code. The caller (directory's search) records
// the call's usage in spend_event with `questionTranslationSpend`, because it alone knows when a call it cancelled at its
// deadline may still have been billed.
import type { SpendEventInput, SpendPurpose } from "@/modules/spend";
import {
  TRANSLATE_SPEND_KIND,
  checkTranslation,
  normaliseTranslation,
  sourceLanguage,
  type QuestionRoute,
  type QuestionSource,
  type TranslationCheckFailure,
} from "../domain/questionTranslation";
import { TranslateError, type Translator } from "./ports";

export type QuestionTranslationFailure = "translate_failed" | "aborted" | TranslationCheckFailure;

/** Why a question could not be used in English. `billedTokens` is set when the model answered (the call was billed). */
export class QuestionTranslationError extends Error {
  override name = "QuestionTranslationError";
  constructor(
    readonly code: QuestionTranslationFailure,
    /** The model answered: what the vendor billed, or null when it did not say. Undefined when it did not answer. */
    readonly billedTokens?: number | null,
  ) {
    super(`The question's translation was not used: ${code}`);
  }
}

export interface QuestionTranslator {
  /** The model that translates this kind of question, or null when the route switches the leg off for it. */
  modelFor(source: QuestionSource): string | null;
  /** The question in English. Throws QuestionTranslationError; `signal` cancels the call. */
  toEnglish(input: { text: string; source: QuestionSource; signal: AbortSignal }): Promise<{ english: string; model: string; tokens: number | null }>;
}

const total = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

export function createQuestionTranslator(deps: { translator: Translator; route: QuestionRoute }): QuestionTranslator {
  const modelFor = (source: QuestionSource) => deps.route[source] ?? null;
  return {
    modelFor,
    async toEnglish({ text, source, signal }) {
      const model = modelFor(source);
      if (model === null) throw new QuestionTranslationError("translate_failed");
      let answer;
      try {
        answer = await deps.translator.translate({ text, from: sourceLanguage(source), to: "en", model, signal });
      } catch (error) {
        throw new QuestionTranslationError(signal.aborted || (error instanceof TranslateError && error.code === "aborted") ? "aborted" : "translate_failed");
      }
      const tokens = total(answer.inputTokens, answer.outputTokens);
      // A late answer after the caller cancelled is not used.
      if (signal.aborted) throw new QuestionTranslationError("aborted", tokens);
      const english = normaliseTranslation(typeof answer.text === "string" ? answer.text : "");
      const failure = checkTranslation(text, english);
      if (failure !== null) throw new QuestionTranslationError(failure, tokens);
      return { english, model, tokens };
    },
  };
}

/** The spend_event of one question translation: counts and codes, never text. `tokens` are the request's and the answer's. */
export function questionTranslationSpend(input: {
  purpose: SpendPurpose;
  model: string;
  releaseV: number | null;
  tokens: number;
  tokensEstimated: boolean;
  ms: number;
}): SpendEventInput {
  return { kind: TRANSLATE_SPEND_KIND, ...input };
}
