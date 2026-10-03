// The translation module's public interface (AD-2, AD-10). S03.05: the Translator port, its Cohere adapter and the
// translated-question leg's translator; E04 adds the alert routes, checks and cache.
export { TranslateError, type TranslateRequest, type Translation, type Translator } from "./application/ports";
export {
  QuestionTranslationError,
  createQuestionTranslator,
  questionTranslationSpend,
  type QuestionTranslationFailure,
  type QuestionTranslator,
} from "./application/questionTranslator";
export {
  ENGLISH_MARGIN,
  QUESTION_SOURCES,
  TRANSLATE_SPEND_KIND,
  checkTranslation,
  estimateTranslationTokens,
  isEnglish,
  normaliseTranslation,
  type QuestionRoute,
  type QuestionSource,
} from "./domain/questionTranslation";
export { MAX_OUTPUT_TOKENS, cohereTranslator, systemPrompt, type CohereChatClient, type CohereTranslatorOptions } from "./adapters/cohereTranslator";
