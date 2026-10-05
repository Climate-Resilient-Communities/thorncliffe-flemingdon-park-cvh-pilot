// The real EntryPreparer (S04.05, closing S04.06's TODO): an entry's English text is translated into every language (S04.02's
// translation, by route, checked and cached), the translations are mapped to what an entry freezes (the one mapper,
// domain/translations.ts), and the text messages are rendered, counted and hashed (freezeContent, S04.06). All of it runs outside any
// database lock and transaction; nothing here reads the database, the clock or the environment (the public origin comes in with
// `freeze`, the composition root's wrapper that reads PUBLIC_BASE_URL through the validated environment).
import type { Translated } from "../../../contracts/translated";
import type { EntryContent } from "../domain/content";
import { freezeTranslations, translatedToFrozen } from "../domain/translations";
import type { FreezeInput } from "./freezeContent";
import type { EntryPreparer, FreezeResult, PrepareContext } from "./ports";

/**
 * Port: translate an English text into every language alerts are translated into. translation's `createSubmitTranslator` and
 * `noTranslation` fit it. It rejects, with nothing translated, when `translation_route` cannot be read in time
 * (AlertRoutesUnavailableError) or holds a row that is not a route (RouteConfigError); a language that no model could
 * translate comes back as the English fallback, never as a rejection.
 */
export interface EntryTranslator {
  translate(input: {
    english: string;
    signal?: AbortSignal;
    onLanguage?: (translated: Translated) => void;
    onBudget?: (budgetMs: number) => void;
    spentMs?: number;
    /** The entry the translation is for, so its vendor usage is told per alert and drills apart (S07.10). */
    entry?: { entryId: string; isDrill: boolean };
  }): Promise<{ translations: readonly Translated[] }>;
}

export interface EntryPreparerDeps {
  translator: EntryTranslator;
  /** freezeContent with the public origin filled in (src/app/staff/freezeEntry.ts reads PUBLIC_BASE_URL through the environment). */
  freeze: (input: Omit<FreezeInput, "publicBaseUrl">) => FreezeResult;
}

export function createEntryPreparer(deps: EntryPreparerDeps): EntryPreparer {
  return {
    async prepare(content: EntryContent, context: PrepareContext, hooks = {}): Promise<FreezeResult> {
      const result = await deps.translator.translate({
        english: content.text,
        signal: hooks.signal,
        onBudget: hooks.onBudget,
        spentMs: hooks.spentMs,
        entry: { entryId: context.entryId, isDrill: context.isDrill },
        onLanguage: (translated) => {
          // Progress is for a screen: a text the mapper refuses here is refused again, loudly, when the whole set is mapped below.
          try {
            hooks.onLanguage?.(translatedToFrozen(translated));
          } catch {
            // Never changes the preparation.
          }
        },
      });
      // A whole, consistent set or a throw (TranslationSetError): a half result is never frozen.
      const translations = freezeTranslations(result.translations, content.text);
      return deps.freeze({
        alertId: context.alertId,
        kind: context.kind,
        supersedesId: context.supersedesId,
        isDrill: context.isDrill,
        channels: context.channels,
        content,
        translations,
        verified: context.verified,
        attribution: context.attribution,
        slug: context.slug,
      });
    },
  };
}
