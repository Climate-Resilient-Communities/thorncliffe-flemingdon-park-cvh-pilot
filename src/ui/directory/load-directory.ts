import { DirectoryListingV1, DirectoryManifestV1 } from "@/contracts/directory";

// How the phone gets the directory (S02.06, AD-11, AD-20). It reads the published release files and nothing else: the
// manifest (never cached), then the listing file of the page language, and keeps the last complete listing it has read.
// A newer release is downloaded whole and checked against its schema before it replaces the kept one; if that fails the
// kept one stays and the resident reads it with "Last updated {time}". Nothing here carries anything about the resident.
// Filtering and browsing then run over this one file, on the phone.

export const MANIFEST_URL = "/api/directory/manifest";
/** localStorage keys of the kept listings, one per language: `cvh.directory.<lang>`. */
export const CACHE_PREFIX = "cvh.directory.";

/** The part of Storage this uses, so a test can pass a plain object. */
export type KeptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export type KeptListing = {
  listing: DirectoryListingV1;
  /** When the release was published (the manifest's `published_at`), for "Last updated {time}". */
  publishedAt: string;
};

export type DirectoryState =
  | { status: "loading" }
  /** `current`: this is the release the server named. Not current: the previous complete release, because the newer one could not be downloaded or the server could not be asked. */
  | { status: "ready"; listing: DirectoryListingV1; publishedAt: string; current: boolean }
  /** Nothing has ever been kept and nothing could be downloaded. */
  | { status: "unavailable" };

const keyOf = (lang: string) => `${CACHE_PREFIX}${lang}`;

/** The kept listing of a language, or null when there is none, it cannot be read or it no longer passes the schema. */
export function readKept(storage: KeptStorage | null, lang: string): KeptListing | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(keyOf(lang));
    if (!raw) return null;
    const value = JSON.parse(raw) as { v?: unknown; publishedAt?: unknown; listing?: unknown };
    if (value.v !== 1 || typeof value.publishedAt !== "string") return null;
    const parsed = DirectoryListingV1.safeParse(value.listing);
    return parsed.success && parsed.data.lang === lang ? { listing: parsed.data, publishedAt: value.publishedAt } : null;
  } catch {
    return null;
  }
}

/** Keeps a complete listing and drops the kept listings of older releases. A full or blocked store only means nothing is kept. */
export function keep(storage: KeptStorage | null, kept: KeptListing): void {
  if (!storage) return;
  try {
    storage.setItem(keyOf(kept.listing.lang), JSON.stringify({ v: 1, publishedAt: kept.publishedAt, listing: kept.listing }));
  } catch {
    return;
  }
  try {
    const old: string[] = [];
    for (let at = 0; at < storage.length; at += 1) {
      const key = storage.key(at);
      if (!key?.startsWith(CACHE_PREFIX) || key === keyOf(kept.listing.lang)) continue;
      const release = readReleaseOf(storage, key);
      if (release !== null && release < kept.listing.release_v) old.push(key);
    }
    for (const key of old) storage.removeItem(key);
  } catch {
    // Old listings that stay are only taking room.
  }
}

function readReleaseOf(storage: KeptStorage, key: string): number | null {
  try {
    const release = (JSON.parse(storage.getItem(key) ?? "null") as { listing?: { release_v?: unknown } } | null)?.listing?.release_v;
    return typeof release === "number" ? release : null;
  } catch {
    return null;
  }
}

type Fetcher = typeof fetch;

/** Reads one JSON body completely. Null for any failure: no signal, a refusal, a body that stops short or is not JSON. */
async function readJson(fetcher: Fetcher, url: string): Promise<unknown> {
  try {
    const response = await fetcher(url, { credentials: "omit", cache: "no-cache", headers: { Accept: "application/json" } });
    // The whole body is read first, so a refusal does not leave the request open and a download cut short throws here.
    const text = await response.text();
    if (!response.ok) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The directory in `lang`. Asks the server which release is current, and:
 * - the kept listing is that release: it is shown;
 * - the server names a newer release (or nothing is kept): that release's file is downloaded completely, checked against
 *   `DirectoryListingV1` (and against the manifest: same release, language and catalogue) and only then kept and shown;
 * - the download fails, is incomplete or fails the check, or the server cannot be asked: the kept listing is shown, not
 *   as current, and the next visit tries again (nothing is remembered about the failure);
 * - nothing was ever kept: `unavailable`.
 * `onKept` is called first with the kept listing, so the list can show while the server is asked.
 */
export async function loadDirectory(
  lang: string,
  deps: { fetcher?: Fetcher; storage?: KeptStorage | null; onKept?: (kept: KeptListing) => void } = {},
): Promise<DirectoryState> {
  const fetcher = deps.fetcher ?? fetch;
  const storage = deps.storage ?? null;
  const kept = readKept(storage, lang);
  if (kept) deps.onKept?.(kept);

  const manifestBody = await readJson(fetcher, MANIFEST_URL);
  const manifest = DirectoryManifestV1.safeParse(manifestBody);
  const previous = (): DirectoryState => (kept ? { status: "ready", ...kept, current: false } : { status: "unavailable" });
  if (!manifest.success) return previous();

  const release = manifest.data;
  if (kept && kept.listing.release_v >= release.release_v) return { status: "ready", ...kept, current: true };

  const path = release.files[lang as keyof typeof release.files];
  if (!path) return previous();
  const listing = DirectoryListingV1.safeParse(await readJson(fetcher, path));
  if (!listing.success) return previous();
  const l = listing.data;
  if (l.release_v !== release.release_v || l.lang !== lang || l.catalogue_hash !== release.catalogue_hash) return previous();

  const fresh: KeptListing = { listing: l, publishedAt: release.published_at };
  keep(storage, fresh);
  return { status: "ready", ...fresh, current: true };
}
