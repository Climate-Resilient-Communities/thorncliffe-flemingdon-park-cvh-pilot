// A test seam for the English fallback (S02.02): CVH_FAKE_UNTRANSLATED_KEYS names catalog keys that every language but
// English shows as English behind the "[EN] " marker, exactly as scripts/gen-strings.cjs writes a key a language lacks.
// The resident page tests start a second server with it, so the fallback rendering (lang="en" dir="ltr" on the block,
// the marker's place, an English date) is measured in a browser on a real page whatever the catalogs have translated.
//
// Local development only: the start-up check (src/platform/config/env.ts) refuses the variable anywhere else, and this
// file ignores it on Vercel and while `next build` prerenders, so no prerendered page and no deployment ever carries it.
// Only pages rendered on request (the Be ready pages) are affected.

export const UNTRANSLATED_KEYS_VARIABLE = "CVH_FAKE_UNTRANSLATED_KEYS";

/** The fallback marker (FALLBACK_MARKER in src/ui and MARKER in scripts/gen-strings.cjs). */
const MARKER = "[EN] ";

/** A full catalog key: dot-separated names, such as `R31.title`. */
const KEY = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;

type Catalog = Record<string, unknown>;

/** The keys a CVH_FAKE_UNTRANSLATED_KEYS value names (comma-separated, spaces ignored), or the first malformed entry. */
export function parseUntranslatedKeys(value: string | undefined): { keys: string[]; problem?: string } {
  const keys = (value ?? "").split(",").map((key) => key.trim()).filter((key) => key !== "");
  const bad = keys.find((key) => !KEY.test(key));
  return bad === undefined ? { keys } : { keys: [], problem: `"${bad}" is not a catalog key such as R31.title` };
}

/**
 * The keys to show as English fallback for this process, or none: only a local process (not on Vercel) that is serving
 * requests, not prerendering pages in `next build`. A malformed value throws, so a broken test setup is loud.
 */
export function untranslatedKeys(source: Record<string, string | undefined> = process.env): string[] {
  const value = source[UNTRANSLATED_KEYS_VARIABLE];
  if (value === undefined || value.trim() === "") return [];
  if (source.VERCEL !== undefined || source.VERCEL_ENV !== undefined) return [];
  if (source.NEXT_PHASE === "phase-production-build") return [];
  const { keys, problem } = parseUntranslatedKeys(value);
  if (problem !== undefined) throw new Error(`${UNTRANSLATED_KEYS_VARIABLE}: ${problem}`);
  return keys;
}

const isCatalog = (value: unknown): value is Catalog => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A copy of `messages` with each of `keys` set to the English string behind the marker. The catalogs passed in are
 * never changed (they are the imported modules every request shares). A key English lacks, or whose English value is
 * not a string, throws: the seam must never quietly do nothing.
 */
export function markUntranslated(messages: Catalog, english: Catalog, keys: readonly string[]): Catalog {
  if (keys.length === 0) return messages;
  const copy = structuredClone(messages);
  for (const key of keys) {
    const path = key.split(".");
    const value = path.reduce<unknown>((node, part) => (isCatalog(node) ? node[part] : undefined), english);
    if (typeof value !== "string") throw new Error(`${UNTRANSLATED_KEYS_VARIABLE}: English has no string ${key}`);
    let node = copy;
    for (const part of path.slice(0, -1)) {
      if (!isCatalog(node[part])) node[part] = {};
      node = node[part] as Catalog;
    }
    node[path.at(-1)!] = MARKER + value;
  }
  return copy;
}
