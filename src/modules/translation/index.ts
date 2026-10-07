// The translation module's public interface (AD-2, AD-10). S03.05: the Translator port, its Cohere adapter and the
// translated-question leg's translator; E04 adds the alert routes, checks and cache.
export { TranslateError, isLimitFailure, type TranslateErrorCode, type TranslateRequest, type Translation, type Translator } from "./application/ports";
export {
  QuestionTranslationError,
  createQuestionTranslator,
  questionTranslationSpend,
  type QuestionTranslationFailure,
  type QuestionTranslator,
} from "./application/questionTranslator";
// S04.02: alerts translated by route (`translation_route`), checked, cached (`translation_cache`) and recorded in spend.
export { PROMPT_VERSION } from "./adapters/cohereTranslator";
export {
  AlertRoutesUnavailableError,
  AlertTranslationInputError,
  STORE_GRACE_MS,
  checkVersion,
  createAlertTranslator,
  type AlertSpendEntry,
  type AlertTranslation,
  type AlertTranslator,
  type AlertTranslatorDeps,
} from "./application/alertTranslator";
export {
  STOP_AFTER_ROUTES_MS,
  createSubmitTranslator,
  noTranslation,
  type SubmitTranslateInput,
  type SubmitTranslation,
  type SubmitTranslator,
  type SubmitTranslatorDeps,
} from "./application/submitTranslator";
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
  SUBMIT_MARGIN_MS,
  buildRoutes,
  longestRouteDeadlineMs,
  routeDeadlineMs,
  submitBudgetMs,
  type RouteLang,
  type RoutePosition,
  type RouteRow,
  type RouteSource,
  type TranslationRoute,
} from "./domain/alertRoutes";
export { readTranslationRoutes } from "./adapters/routeStore";
export { sampleTranslator } from "./adapters/sampleTranslator";
export { drizzleTranslationCache } from "./adapters/cacheStore";
export {
  ENGLISH_MARGIN,
  QUESTION_SOURCES,
  TRANSLATE_FIRST_OFF,
  TRANSLATE_FIRST_SOURCES,
  TRANSLATE_SPEND_KIND,
  checkTranslation,
  estimateTranslationTokens,
  isEnglish,
  isTranslateFirstSource,
  normaliseTranslation,
  sourceLanguage,
  type QuestionRoute,
  type QuestionSource,
  type TranslateFirstSource,
} from "./domain/questionTranslation";
export { MAX_OUTPUT_TOKENS, classifyCohereError, cohereTranslator, systemPrompt, type CohereChatClient, type CohereTranslatorOptions } from "./adapters/cohereTranslator";
