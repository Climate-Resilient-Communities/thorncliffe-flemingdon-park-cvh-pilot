// What translating an alert needs from outside the translation module (S04.02, AD-2, AD-10): the cache and OpenCC. The
// translation model is the Translator port (ports.ts); the routes are read from `translation_route` by adapters/routeStore.ts;
// usage goes to spend through a function the caller gives. Each has a fake in the tests.
import type { CachedTranslation, TranslationCacheKey } from "../domain/alertTranslation";

/**
 * The cache of passing results, keyed by every part of AD-10's key. `get` returns a result only when every part matches.
 * Only passing results are put: a failure never reaches here. Either call may fail; the translation then goes on without it.
 */
export interface TranslationCache {
  get(key: TranslationCacheKey): Promise<CachedTranslation | null>;
  put(key: TranslationCacheKey, value: CachedTranslation): Promise<void>;
}

/**
 * OpenCC for zh-Hant, with the version and configuration that go in the cache key and beside each converted text. The
 * same shape directory's `openccZhHant` returns (it loads the dictionaries on first use); the composition root passes that
 * in, because translation may not import directory.
 */
export interface ZhHantConverter {
  convert(text: string): string;
  openccVersion: string;
  config: string;
}
