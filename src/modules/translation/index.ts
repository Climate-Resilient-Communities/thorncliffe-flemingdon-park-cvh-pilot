// The translation module's public interface (AD-2, AD-10). S03.05: the Translator port, its Cohere adapter and the
// translated-question leg's translator. S04.02: alerts translated by route (`translation_route`), checked, cached
// (`translation_cache`) and recorded in spend.
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
  sourceLanguage,
  type QuestionRoute,
  type QuestionSource,
} from "./domain/questionTranslation";
export { MAX_OUTPUT_TOKENS, PROMPT_VERSION, cohereTranslator, systemPrompt, warmCohereTranslator, type CohereChatClient, type CohereTranslatorOptions } from "./adapters/cohereTranslator";
export {
  AlertTranslationInputError,
  checkVersion,
  createAlertTranslator,
  type AlertTranslation,
  type AlertTranslator,
  type AlertTranslatorDeps,
} from "./application/alertTranslator";
export type { TranslationCache, ZhHantConverter } from "./application/alertPorts";
export {
  ALERT_MAX_OUTPUT_TOKENS,
  ALERT_SPEND_KIND,
  ALERT_TARGET_LANGS,
  type AttemptOutcome,
  type AttemptResult,
  type CachedTranslation,
  type LanguageOutcome,
  type TranslationCacheKey,
} from "./domain/alertTranslation";
export { CHECK_LOGIC_VERSION, ELD_VERSION, checkAlertTranslation, type AlertCheckFailure, type CheckScript, type LanguageCheck } from "./domain/alertChecks";
export {
  MAX_ATTEMPT_TIMEOUT_MS,
  MAX_ROUTE_DEADLINE_MS,
  ROUTE_LANGS,
  RouteConfigError,
  buildRoutes,
  routeDeadlineMs,
  type RouteLang,
  type RoutePosition,
  type RouteRow,
  type RouteSource,
  type TranslationRoute,
} from "./domain/alertRoutes";
export { readTranslationRoutes } from "./adapters/routeStore";
export { drizzleTranslationCache } from "./adapters/cacheStore";
