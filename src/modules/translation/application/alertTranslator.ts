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
// Passing results are cached under every part of AD-10's key, and only passing results: a failure is never cached, so a
// failed language is tried again next time. Each call to a model records its usage in spend_event, without text: what the
// vendor billed, or an estimate for a call that was aborted before it answered.
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
  type LanguageOutcome,
  type TranslationCacheKey,
} from "../domain/alertTranslation";
import { normaliseTranslation } from "../domain/questionTranslation";
import type { TranslationCache, ZhHantConverter } from "./alertPorts";
import type { Translator } from "./ports";

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
  /** Called with each language's text the moment it is settled, so a screen can show progress per language. A failure in it is ignored. */
  onLanguage?: (translated: Translated) => void;
}

export interface AlertTranslation {
  /** One text per language but English, in LANG_CODES order: `ok`, `script_converted` or `fallback_en`. */
  translations: Translated[];
  /** How each language ended, in the same order. */
  outcomes: LanguageOutcome[];
  /** Spend events that could not be written (the translation went on). */
  spendFailures: number;
  /** Cache reads or writes that failed (the translation went on as if the cache missed). */
  cacheFailures: number;
}

export interface AlertTranslator {
  /** Translates `english` into every language. Resolves with a text for each; `signal` cancels what is still running (those languages end as `fallback_en`, and the caller, which cancelled, discards the result). */
  translate(input: { english: string; signal?: AbortSignal }): Promise<AlertTranslation>;
}

/** The English text to translate is empty: a bug in the caller, which validates an entry's text before it asks. */
export class AlertTranslationInputError extends Error {
  override name = "AlertTranslationInputError";
  constructor() {
    super("There is no English text to translate");
  }
}

type Stop = "deadline" | "cancelled";
type CallResult = { text: string } | { failure: Exclude<AttemptResult, "cached" | "passed"> };
interface LanguageRun {
  translated: Translated;
  outcome: LanguageOutcome;
}

export function createAlertTranslator(deps: AlertTranslatorDeps): AlertTranslator {
  const clock = deps.clock ?? (() => performance.now());

  return {
    async translate({ english, signal }) {
      if (english.trim() === "") throw new AlertTranslationInputError();
      const sourceHash = sha256Hex(english);
      const routes = new Map((await deps.routes()).map((route) => [route.lang, route]));
      const pending: Promise<void>[] = [];
      let spendFailures = 0;
      let cacheFailures = 0;

      const recordSpend = (event: SpendEventInput) => {
        pending.push(
          Promise.resolve()
            .then(() => deps.recordSpend(event))
            .catch(() => {
              spendFailures += 1;
            }),
        );
      };
      const readCache = async (key: TranslationCacheKey) => {
        try {
          return await deps.cache.get(key);
        } catch {
          cacheFailures += 1;
          return null;
        }
      };
      const writeCache = async (key: TranslationCacheKey, value: Parameters<TranslationCache["put"]>[1]) => {
        try {
          await deps.cache.put(key, value);
        } catch {
          cacheFailures += 1;
        }
      };

      const fallback = (lang: Exclude<LangCode, "en">): Translated => ({ lang, body: english, machine: false, model: null, status: "fallback_en", source_hash: sourceHash });
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
          const text = normaliseTranslation(typeof answer.value?.text === "string" ? answer.value.text : "");
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
            const cached = await readCache(key);
            if (state.stop !== null) break;
            if (cached !== null && cached.status === "ok") {
              attempts.push({ position: position.position, model: position.model, result: "cached", ms: 0 });
              return finished(done({ lang, body: cached.body, machine: true, model: position.model, status: "ok", source_hash: sourceHash }, attempts, null));
            }
            const began = clock();
            const result = await callModel(route, position.model, position.attemptTimeoutMs, language.signal, () => state.stop ?? "deadline");
            const ms = Math.max(0, Math.round(clock() - began));
            if ("text" in result) {
              attempts.push({ position: position.position, model: position.model, result: "passed", ms });
              await writeCache(key, { body: result.text, status: "ok", fromTextHash: null });
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
          const converter = await deps.zhHant();
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
          const cached = await readCache(key);
          let body = cached !== null && cached.status === "script_converted" && cached.fromTextHash === fromTextHash ? cached.body : null;
          if (body === null) {
            body = converter.convert(zh.translated.body);
            if (typeof body !== "string" || body.trim() === "") return done(fallback("zh-Hant"), "conversion_failed");
            await writeCache(key, { body, status: "script_converted", fromTextHash });
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

