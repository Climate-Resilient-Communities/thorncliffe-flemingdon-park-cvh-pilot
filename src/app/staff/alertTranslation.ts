// Composition root of an alert's translation for the staff surface (AD-2, AD-10, S04.05): the routes read from `translation_route`,
// the cache of passing results, the spend record, OpenCC for zh-Hant (directory's converter, which translation may not import) and the
// model. The model is Cohere's where a key is configured (production only, AD-15), the sample fake where CVH_FAKE_TRANSLATOR=sample
// (local development and the end-to-end tests), and nothing otherwise: with no model every language is the English fallback, which a
// submit still freezes whole and the approver sees. Server only.
import "server-only";
import { openccZhHant } from "@/modules/directory";
import { recordSpendEvent } from "@/modules/spend";
import {
  PROMPT_VERSION,
  cohereTranslator,
  createSubmitTranslator,
  drizzleTranslationCache,
  noTranslation,
  readTranslationRoutes,
  sampleTranslator,
  type SubmitTranslator,
  type Translator,
} from "@/modules/translation";
import { getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";

/** The translation model of this environment, or null where there is none. */
function model(): Translator | null {
  const env = getEnv();
  if (env.fakeTranslator === "sample") return sampleTranslator();
  return env.cohereApiKey ? cohereTranslator({ apiKey: env.cohereApiKey }) : null;
}

export interface AlertTranslation {
  translator: SubmitTranslator;
  /** Whether a model is configured: with none, every language falling back is expected here. */
  configured: boolean;
}

/** The translation a submit uses. */
export function alertTranslation(): AlertTranslation {
  const translator = model();
  if (translator === null) return { translator: noTranslation(), configured: false };
  const db = getDb();
  return {
    configured: true,
    translator: createSubmitTranslator({
      translator,
      routes: () => readTranslationRoutes(db),
      cache: drizzleTranslationCache(db),
      recordSpend: (event) => recordSpendEvent(db, event),
      zhHant: openccZhHant,
      promptVersion: PROMPT_VERSION,
    }),
  };
}
