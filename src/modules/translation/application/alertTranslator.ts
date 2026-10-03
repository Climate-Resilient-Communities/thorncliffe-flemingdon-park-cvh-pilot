// An alert's English text, translated into every launch language by route (S04.02, AD-10, AR-14, D-4, D-5).
//
// Every language runs in parallel. Each tries its route's models in order, every attempt with its own timeout and the
// whole language with the route's deadline (the sum of the attempt timeouts, counted from the language's start): an
// attempt that reaches either is aborted and counts as a failure, and an answer that arrives after the abort is never
// used. A model's output is normalised and checked (domain/alertChecks.ts); a failed check, an error, a timeout and an
// empty answer are all failures, and the next model runs. When every model fails, the language is the English text with
// status `fallback_en`: a language never ends without a result, and a wrong-language text is never one.
//
// `zh-Hant` is not translated: once zh has passed it is converted with OpenCC and marked `script_converted`.
//
// Digits are Western (0-9) in every language until each community decides (prototype design note D-13): whatever digits a
// model writes (Arabic-Indic, Devanagari, Bengali ...) are mapped to 0-9 before the output is checked, cached or returned,
// the same as the offline catalogue script does.
//
// Passing results are cached under every part of AD-10's key, and only passing results: a failure is never cached, so a
// failed language is tried again next time. A cached text is checked again when it is read: one that no longer passes (the
// table gives the app no way to change one, so this means it was changed outside the app) is not used. Each call to a model
// records its usage in spend_event, without text: what the vendor billed, or an estimate for a call that was aborted before
// it answered.
//
// No store is waited for without limit. A cache read ends at the language's stop (its route deadline or the caller's cancel)
// and, if the store does not answer within STORE_GRACE_MS, counts as a miss; a cache write and a spend write that do not
// finish within STORE_GRACE_MS are given up (counted, never failing the translation) and the language does not wait for them.
// So a language ends by its route deadline whatever the stores do, and `translate` resolves within the longest route deadline
// plus a few grace periods (the submit budget's 5 s).
//
// The result carries codes and counts only (how each attempt ended), never text beyond the Translated texts themselves.
// Nothing here knows a vendor's language code: the Translator port takes LangCode, and the adapter maps it.
import { LANG_CODES, type LangCode } from "@/contracts/lang";
import type { Translated } from "@/contracts/translated";
import type { SpendEventInput } from "@/modules/spend";
import { sha256Hex } from "@/platform/hash";
import { CHECK_LOGIC_VERSION, ELD_VERSION, canonicalCheck, checkAlertTranslation, type LanguageCheck } from "../domain/alertChecks";
import type { TranslationRoute } from "../domain/alertRoutes";
import {
  ALERT_MAX_OUTPUT_TOKENS,
  ALERT_SPEND_KIND,
  ALERT_TARGET_LANGS,
  estimateAlertCallTokens,
  type AttemptOutcome,
  type AttemptResult,
  type CachedTranslation,
  type LanguageOutcome,
  type TranslationCacheKey,
} from "../domain/alertTranslation";
import { normaliseTranslation } from "../domain/questionTranslation";
import { toWesternDigits } from "../domain/westernDigits";
import type { TranslationCache, ZhHantConverter } from "./alertPorts";
import type { Translator } from "./ports";

/**
 * The longest a store (the routes, a cache read or write, a spend write) is waited for, in milliseconds. A read that does not
 * answer in time counts as a miss, a write that does not finish is given up, and the failure is counted, never failing the
 * translation. Short enough that the worst case, four of them one after another (the routes read; then, after the longest
 * route deadline, zh-Hant's converter, its cache read and the final flush of writes), stays inside the submit budget (that
 * deadline plus 5 s).
 */
export const STORE_GRACE_MS = 1000;

/** The check version of one language: the rules' version, `eld`'s, and the language's own check (a route row), so changing any of them is a new key. */
export function checkVersion(check: LanguageCheck): string {
  return `${CHECK_LOGIC_VERSION}.eld${ELD_VERSION}.${sha256Hex(canonicalCheck(check)).slice(0, 12)}`;
}

export interface AlertTranslatorDeps {
  translator: Translator;
  /** The routes, read from `translation_route` for each translation, so a changed route applies to the next submit. */
  routes: () => Promise<readonly TranslationRoute[]>;
  cache: TranslationCache;
  /** Writes one spend event (the caller's spend_event writer). A failure is counted and never fails the translation. */
  recordSpend: (event: SpendEventInput) => Promise<void>;
  /** OpenCC, loaded when zh passes. */
  zhHant: () => Promise<ZhHantConverter>;
  /** The adapter's PROMPT_VERSION: part of the cache key. */
  promptVersion: string;
  /** Replaces the derived check version of every language (a test's way of changing the checks). */
  checkVersion?: string;
  /** Milliseconds from a monotonic clock, to time attempts. Defaults to performance.now. */
  clock?: () => number;
  /** How long a store is waited for (see STORE_GRACE_MS). Defaults to STORE_GRACE_MS. */
  storeGraceMs?: number;
  /** Called with each language's text the moment it is settled, so a screen can show progress per language. A failure in it is ignored. */
  onLanguage?: (translated: Translated) => void;
}

export interface AlertTranslation {
  /** One text per language but English, in LANG_CODES order: `ok`, `script_converted` or `fallback_en`. */
  translations: Translated[];
  /** How each language ended, in the same order. */
  outcomes: LanguageOutcome[];
  /** Spend events that could not be written, or not within STORE_GRACE_MS (the translation went on). */
  spendFailures: number;
  /** Cache reads or writes that failed or were too slow, and cached texts that no longer pass their check (the translation went on as if the cache missed). */
  cacheFailures: number;
}

export interface AlertTranslator {
  /**
   * Translates `english` into every language. Resolves with a text for each; `signal` cancels what is still running (those
   * languages end as `fallback_en` at once, and the caller, which cancelled, discards the result). It never waits for a
   * store without limit. It rejects only when the English is empty (AlertTranslationInputError) or the routes cannot be read
   * (what `routes` threw, or AlertRoutesUnavailableError when it did not answer within STORE_GRACE_MS).
   */
  translate(input: { english: string; signal?: AbortSignal }): Promise<AlertTranslation>;
}

/** The English text to translate is empty: a bug in the caller, which validates an entry's text before it asks. */
export class AlertTranslationInputError extends Error {
  override name = "AlertTranslationInputError";
  constructor() {
    super("There is no English text to translate");
  }
}

/** `routes` did not answer within STORE_GRACE_MS: no language can be translated without its route, and the submit is not left waiting for them. */
export class AlertRoutesUnavailableError extends Error {
  override name = "AlertRoutesUnavailableError";
  constructor() {
    super("The translation routes could not be read in time");
  }
}

type Stop = "deadline" | "cancelled";
/** How a wait on a store ended: its answer, its failure, the grace running out (it is left to finish on its own), or the stop signal. */
type Waited<T> = { ended: "value"; value: T } | { ended: "failed"; error: unknown } | { ended: "late" } | { ended: "stopped" };

/**
 * Waits for `work` for at most `ms`, and no longer than `stop` allows. Never rejects and leaves no timer behind. Work that is
 * still running when the wait ends is not cancelled (the stores take no signal), but its result, or its failure, is ignored.
 */
function waitFor<T>(work: () => Promise<T>, ms: number, stop?: AbortSignal): Promise<Waited<T>> {
  return new Promise((resolve) => {
    const end = (result: Waited<T>) => {
      clearTimeout(timer);
      stop?.removeEventListener("abort", onStop);
      resolve(result);
    };
    const onStop = () => end({ ended: "stopped" });
    const timer = setTimeout(() => end({ ended: "late" }), ms);
    if (stop?.aborted) return end({ ended: "stopped" });
    stop?.addEventListener("abort", onStop, { once: true });
    Promise.resolve()
      .then(work)
      .then(
        (value) => end({ ended: "value", value }),
        (error: unknown) => end({ ended: "failed", error }),
      );
  });
}

type CallResult = { text: string } | { failure: Exclude<AttemptResult, "cached" | "passed"> };
interface LanguageRun {
  translated: Translated;
  outcome: LanguageOutcome;
}

export function createAlertTranslator(deps: AlertTranslatorDeps): AlertTranslator {
  const clock = deps.clock ?? (() => performance.now());
  const grace = deps.storeGraceMs ?? STORE_GRACE_MS;

  return {
    async translate({ english, signal }) {
      if (english.trim() === "") throw new AlertTranslationInputError();
      const sourceHash = sha256Hex(english);
      const pending: Promise<void>[] = [];
      let spendFailures = 0;
      let cacheFailures = 0;

      const fallback = (lang: Exclude<LangCode, "en">): Translated => ({ lang, body: english, machine: false, model: null, status: "fallback_en", source_hash: sourceHash });

      // Without its routes nothing can be translated. A caller that cancels meanwhile gets every language as the English, at once.
      const loaded = await waitFor(() => deps.routes(), grace, signal);
      if (loaded.ended === "failed") throw loaded.error;
      if (loaded.ended === "late") throw new AlertRoutesUnavailableError();
      if (loaded.ended === "stopped") {
        const translations = ALERT_TARGET_LANGS.map(fallback);
        const outcomes = ALERT_TARGET_LANGS.map((lang): LanguageOutcome => ({ lang, status: "fallback_en", fallbackReason: "cancelled", attempts: [], ms: 0 }));
        return { translations, outcomes, spendFailures, cacheFailures };
      }
      const routes = new Map(loaded.value.map((route) => [route.lang, route]));

      /** A write is not waited for by the language that made it: it is given up after the grace, and `translate` waits for every one before it resolves. */
      const recordSpend = (event: SpendEventInput) => {
        pending.push(
          waitFor(() => deps.recordSpend(event), grace).then((write) => {
            if (write.ended !== "value") spendFailures += 1;
          }),
        );
      };
      /** A read ends at `stop` (a miss); one that fails or is too slow is a miss and counted. */
      const readCache = async (key: TranslationCacheKey, stop?: AbortSignal): Promise<CachedTranslation | null> => {
        const read = await waitFor(() => deps.cache.get(key), grace, stop);
        if (read.ended === "value") return read.value;
        if (read.ended !== "stopped") cacheFailures += 1;
        return null;
      };
      const writeCache = (key: TranslationCacheKey, value: CachedTranslation) => {
        pending.push(
          waitFor(() => deps.cache.put(key, value), grace).then((write) => {
            if (write.ended !== "value") cacheFailures += 1;
          }),
        );
      };

      const finished = (run: LanguageRun): LanguageRun => {
        try {
          deps.onLanguage?.(run.translated);
        } catch {
          // A progress callback never changes a translation.
        }
        return run;
      };

      const spendEvent = (model: string, tokens: number, estimated: boolean, ms: number): SpendEventInput => ({
        kind: ALERT_SPEND_KIND,
        purpose: "alert",
        model,
        releaseV: null,
        tokens,
        tokensEstimated: estimated,
        ms,
      });

      /** Calls one model for one language: the attempt's own timeout, the language's stop, and no use of an answer that comes after either. */
      const callModel = async (route: TranslationRoute, model: string, timeoutMs: number, language: AbortSignal, stopped: () => Stop): Promise<CallResult> => {
        const attempt = new AbortController();
        const state: { ended: "timed_out" | Stop | null } = { ended: null };
        const end = (why: "timed_out" | Stop) => {
          if (state.ended !== null) return;
          state.ended = why;
          attempt.abort();
        };
        const started = clock();
        const elapsed = () => Math.max(0, Math.round(clock() - started));
        const timer = setTimeout(() => end("timed_out"), timeoutMs);
        // The language's stop. An attempt that had already used its whole allowance when the deadline came (the last attempt's
        // own timeout and the route deadline end together) timed out.
        const follow = () => end(stopped() === "deadline" && elapsed() >= timeoutMs ? "timed_out" : stopped());
        if (language.aborted) follow();
        else language.addEventListener("abort", follow, { once: true });
        try {
          const call = Promise.resolve().then(() =>
            deps.translator.translate({ text: english, from: "en", to: route.lang, model, signal: attempt.signal, maxOutputTokens: ALERT_MAX_OUTPUT_TOKENS }),
          );
          const settled = call.then(
            (value) => ({ value }) as const,
            (error: unknown) => ({ error }) as const,
          );
          const aborted = new Promise<"aborted">((resolve) => {
            if (attempt.signal.aborted) resolve("aborted");
            else attempt.signal.addEventListener("abort", () => resolve("aborted"), { once: true });
          });
          const answer = await Promise.race([settled, aborted]);

          if (answer === "aborted" || state.ended !== null) {
            // A call cancelled before it answered may still have been billed: counted as an estimate. Its late answer, if one
            // comes, is dropped by `settled` and never read.
            const billed = answer !== "aborted" && "value" in answer ? tokensOf(answer.value) : null;
            recordSpend(spendEvent(model, billed ?? estimateAlertCallTokens(english), billed === null, elapsed()));
            return { failure: state.ended ?? "timed_out" };
          }
          if ("error" in answer) {
            // The vendor failed: nothing was billed, but the call and its time are still recorded.
            recordSpend(spendEvent(model, 0, false, elapsed()));
            return { failure: "failed" };
          }
          const billed = tokensOf(answer.value);
          recordSpend(spendEvent(model, billed ?? estimateAlertCallTokens(english), billed === null, elapsed()));
          const text = toWesternDigits(normaliseTranslation(typeof answer.value?.text === "string" ? answer.value.text : ""));
          const failure = checkAlertTranslation(route.check, english, text);
          return failure === null ? { text } : { failure };
        } catch {
          // Checking or recording went wrong: this attempt is a failure like any other, and the next model runs.
          return { failure: "failed" };
        } finally {
          clearTimeout(timer);
          language.removeEventListener("abort", follow);
        }
      };

      const translateLanguage = async (lang: Exclude<LangCode, "en" | "zh-Hant">): Promise<LanguageRun> => {
        const started = clock();
        const route = routes.get(lang as TranslationRoute["lang"]);
        const done = (translated: Translated, attempts: AttemptOutcome[], fallbackReason: LanguageOutcome["fallbackReason"]): LanguageRun => ({
          translated,
          outcome: { lang, status: translated.status as LanguageOutcome["status"], fallbackReason, attempts, ms: Math.max(0, Math.round(clock() - started)) },
        });
        if (!route) return finished(done(fallback(lang), [], "no_route"));

        const attempts: AttemptOutcome[] = [];
        // The route deadline runs from here, or until the caller cancels.
        const language = new AbortController();
        const state: { stop: Stop | null } = { stop: null };
        const stopLanguage = (why: Stop) => {
          if (state.stop !== null) return;
          state.stop = why;
          language.abort();
        };
        const deadline = setTimeout(() => stopLanguage("deadline"), route.deadlineMs);
        const cancel = () => stopLanguage("cancelled");
        if (signal?.aborted) cancel();
        else signal?.addEventListener("abort", cancel, { once: true });

        try {
          const version = deps.checkVersion ?? checkVersion(route.check);
          for (const position of route.positions) {
            if (state.stop !== null) break;
            const key: TranslationCacheKey = { sourceHash, lang, modelId: position.model, promptVersion: deps.promptVersion, checkVersion: version, openccVersion: "", openccConfig: "" };
            const cached = await readCache(key, language.signal);
            if (state.stop !== null) break;
            if (cached !== null && cached.status === "ok") {
              // A stored text is checked again as it is read: one that fails the check is not used and the model is asked. The
              // key holds the check's version, so a failing hit was changed outside the app, never by a change of the checks.
              if (checkAlertTranslation(route.check, english, cached.body) === null) {
                attempts.push({ position: position.position, model: position.model, result: "cached", ms: 0 });
                return finished(done({ lang, body: cached.body, machine: true, model: position.model, status: "ok", source_hash: sourceHash }, attempts, null));
              }
              cacheFailures += 1;
            }
            const began = clock();
            const result = await callModel(route, position.model, position.attemptTimeoutMs, language.signal, () => state.stop ?? "deadline");
            const ms = Math.max(0, Math.round(clock() - began));
            if ("text" in result) {
              attempts.push({ position: position.position, model: position.model, result: "passed", ms });
              writeCache(key, { body: result.text, status: "ok", fromTextHash: null });
              return finished(done({ lang, body: result.text, machine: true, model: position.model, status: "ok", source_hash: sourceHash }, attempts, null));
            }
            attempts.push({ position: position.position, model: position.model, result: result.failure, ms });
          }
          return finished(done(fallback(lang), attempts, state.stop === "cancelled" ? "cancelled" : "route_exhausted"));
        } finally {
          clearTimeout(deadline);
          signal?.removeEventListener("abort", cancel);
        }
      };

      /** zh-Hant: the passing zh text converted by OpenCC, recorded with the zh text's hash, OpenCC's version and its configuration. */
      const convertZhHant = async (zh: LanguageRun): Promise<LanguageRun> => {
        const started = clock();
        const done = (translated: Translated, fallbackReason: LanguageOutcome["fallbackReason"]): LanguageRun =>
          finished({
            translated,
            outcome: { lang: "zh-Hant", status: translated.status as LanguageOutcome["status"], fallbackReason, attempts: [], ms: Math.max(0, Math.round(clock() - started)) },
          });
        if (zh.translated.status !== "ok" || zh.translated.model === null) return done(fallback("zh-Hant"), "zh_unavailable");
        try {
          const loadedConverter = await waitFor(() => deps.zhHant(), grace, signal);
          if (loadedConverter.ended !== "value") return done(fallback("zh-Hant"), loadedConverter.ended === "stopped" ? "cancelled" : "conversion_failed");
          const converter = loadedConverter.value;
          const zhRoute = routes.get("zh")!;
          const fromTextHash = sha256Hex(zh.translated.body);
          const key: TranslationCacheKey = {
            sourceHash,
            lang: "zh-Hant",
            modelId: zh.translated.model,
            promptVersion: deps.promptVersion,
            checkVersion: deps.checkVersion ?? checkVersion(zhRoute.check),
            openccVersion: converter.openccVersion,
            openccConfig: converter.config,
          };
          // A cached conversion is reused only if it was made from the very zh text in hand.
          const cached = await readCache(key, signal);
          if (signal?.aborted) return done(fallback("zh-Hant"), "cancelled");
          let body = cached !== null && cached.status === "script_converted" && cached.fromTextHash === fromTextHash ? cached.body : null;
          if (body === null) {
            body = converter.convert(zh.translated.body);
            if (typeof body !== "string" || body.trim() === "") return done(fallback("zh-Hant"), "conversion_failed");
            writeCache(key, { body, status: "script_converted", fromTextHash });
          }
          return done(
            {
              lang: "zh-Hant",
              body,
              machine: true,
              model: `opencc-js ${converter.openccVersion}`,
              status: "script_converted",
              source_hash: sourceHash,
              conversion: { from: "zh", from_text_hash: fromTextHash, opencc_version: converter.openccVersion, config: converter.config },
            },
            null,
          );
        } catch {
          return done(fallback("zh-Hant"), "conversion_failed");
        }
      };

      const runs = new Map<Exclude<LangCode, "en">, Promise<LanguageRun>>();
      for (const lang of ALERT_TARGET_LANGS) {
        if (lang === "zh-Hant") continue;
        runs.set(lang, translateLanguage(lang));
      }
      runs.set("zh-Hant", runs.get("zh")!.then(convertZhHant));

      const ordered = await Promise.all(LANG_CODES.filter((lang): lang is Exclude<LangCode, "en"> => lang !== "en").map((lang) => runs.get(lang)!));
      await Promise.all(pending);
      return { translations: ordered.map((run) => run.translated), outcomes: ordered.map((run) => run.outcome), spendFailures, cacheFailures };
    },
  };
}

/** The tokens the vendor billed for a call (the request's and the answer's together), or null when it did not say. */
function tokensOf(value: { inputTokens: number | null; outputTokens: number | null } | undefined): number | null {
  if (!value) return null;
  const { inputTokens, outputTokens } = value;
  const known = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (!known(inputTokens) && !known(outputTokens)) return null;
  return Math.round((known(inputTokens) ? inputTokens : 0) + (known(outputTokens) ? outputTokens : 0));
}

