// An alert's translation as a submit runs it (S04.05, AD-10, epic E04 "Submit budget"): the routes are read once, the budget (the
// longest route deadline plus 5 s) is known before any model is asked, and a backstop ends the translation inside it whatever
// the stores and the models do, so the author is never left without a result.
//
// The alert translator (alertTranslator.ts) already ends every language by its route deadline and every store wait by its grace;
// its own worst case is the longest route deadline plus three graces (zh-Hant's converter, its cache read and the final flush of
// writes). This wrapper adds the one thing a submit needs on top: a stop at the longest route deadline plus 3 s, counted from the
// moment the models are first asked, which leaves 2 s of the 5 s for reading the routes before it and for rendering and freezing
// after it. A language still running when the stop comes ends as the English fallback at once (a cancelled attempt, never used).
//
// Rejections are the alert translator's: AlertTranslationInputError for empty English; what `routes` threw (RouteConfigError for a
// row that is not a route) or AlertRoutesUnavailableError when the routes did not answer within the store grace. Nothing is
// translated and nothing half-made is returned in those cases: the caller refuses the submit.
import type { Translated } from "@/contracts/translated";
import { sha256Hex } from "@/platform/hash";
import { ALERT_TARGET_LANGS } from "../domain/alertTranslation";
import { longestRouteDeadlineMs, submitBudgetMs, type TranslationRoute } from "../domain/alertRoutes";
import {
  AlertRoutesUnavailableError,
  STORE_GRACE_MS,
  createAlertTranslator,
  type AlertTranslation,
  type AlertTranslatorDeps,
} from "./alertTranslator";

/** The stop comes this long after the longest route deadline: the budget's 5 s less 2 s for the route read and the freeze. */
export const STOP_AFTER_ROUTES_MS = 3_000;

export interface SubmitTranslatorDeps extends Omit<AlertTranslatorDeps, "routes" | "onLanguage"> {
  /** The routes, read from `translation_route` once for each submit. */
  routes: () => Promise<readonly TranslationRoute[]>;
}

export interface SubmitTranslation extends AlertTranslation {
  /** The longest route deadline plus 5 s, in milliseconds. */
  budgetMs: number;
  /** True when the stop at the end of the budget cut the translation short (languages still running ended as the English fallback). */
  stoppedAtBudget: boolean;
}

export interface SubmitTranslateInput {
  english: string;
  /** The caller's cancel: what is still running ends as the English fallback. */
  signal?: AbortSignal;
  /** Called as each language settles, so a screen can show progress per language. A failure in it is ignored. */
  onLanguage?: (translated: Translated) => void;
  /** Called once the budget is known, before any model is asked. A failure in it is ignored. */
  onBudget?: (budgetMs: number) => void;
}

export interface SubmitTranslator {
  translate(input: SubmitTranslateInput): Promise<SubmitTranslation>;
}

/** Reads the routes, waiting at most `graceMs`; rejects with what `routes` threw, or AlertRoutesUnavailableError. */
function readRoutes(read: () => Promise<readonly TranslationRoute[]>, graceMs: number): Promise<readonly TranslationRoute[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AlertRoutesUnavailableError()), graceMs);
    Promise.resolve()
      .then(read)
      .then(
        (routes) => {
          clearTimeout(timer);
          resolve(routes);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

export function createSubmitTranslator(deps: SubmitTranslatorDeps): SubmitTranslator {
  const grace = deps.storeGraceMs ?? STORE_GRACE_MS;
  return {
    async translate({ english, signal, onLanguage, onBudget }) {
      const routes = await readRoutes(deps.routes, grace);
      const budgetMs = submitBudgetMs(routes);
      try {
        onBudget?.(budgetMs);
      } catch {
        // A progress callback never changes a translation.
      }
      const stop = new AbortController();
      const follow = () => stop.abort();
      if (signal?.aborted) stop.abort();
      else signal?.addEventListener("abort", follow, { once: true });
      let stoppedAtBudget = false;
      const timer = setTimeout(() => {
        stoppedAtBudget = true;
        stop.abort();
      }, longestRouteDeadlineMs(routes) + STOP_AFTER_ROUTES_MS);
      try {
        const translator = createAlertTranslator({ ...deps, routes: async () => routes, onLanguage });
        const result = await translator.translate({ english, signal: stop.signal });
        return { ...result, budgetMs, stoppedAtBudget: stoppedAtBudget && !signal?.aborted };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", follow);
      }
    },
  };
}

/**
 * The translation of an environment with no translation model (no Cohere key: every environment but production): every language
 * is the English text, as the fallback `fallback_en`, with no model asked and nothing recorded. A submit still freezes a whole,
 * consistent set; the approver sees that every language fell back.
 */
export function noTranslation(): SubmitTranslator {
  return {
    translate: async ({ english, onLanguage }) => {
      const source = sha256Hex(english);
      const translations: Translated[] = ALERT_TARGET_LANGS.map((lang) => ({ lang, body: english, machine: false, model: null, status: "fallback_en", source_hash: source }));
      for (const translated of translations) {
        try {
          onLanguage?.(translated);
        } catch {
          // A progress callback never changes a translation.
        }
      }
      return {
        translations,
        outcomes: ALERT_TARGET_LANGS.map((lang) => ({ lang, status: "fallback_en" as const, fallbackReason: "no_route" as const, attempts: [], ms: 0 })),
        spendFailures: 0,
        cacheFailures: 0,
        budgetMs: submitBudgetMs([]),
        stoppedAtBudget: false,
      };
    },
  };
}

