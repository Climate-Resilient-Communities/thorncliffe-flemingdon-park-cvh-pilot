import { DirectoryListingV1, DirectoryManifestV1 } from "@/contracts/directory";

// How the phone gets the directory (S02.06, AD-11, AD-20). It reads the published release files and nothing else: the
// manifest (never cached), then the listing file of the page language, and keeps the last complete listing it has read.
// A newer release is downloaded whole and checked against its schema before it replaces the kept one; if that fails the
// kept one stays and the resident reads it with "Last updated {time}". Nothing here carries anything about the resident.
// Filtering and browsing then run over this one file, on the phone.

export const MANIFEST_URL = "/api/directory/manifest";
/** localStorage keys of the kept listings, one per language: `cvh.directory.<lang>`. */
export const CACHE_PREFIX = "cvh.directory.";
/** How long one request for the manifest or a listing file may take, body included, before it counts as not reachable. */
export const FETCH_TIMEOUT_MS = 8000;
/**
 * The header with which a service worker marks a response it made up because the network was down (S02.12). A response
 * that carries it is not the server's answer, so it counts as unreachable here.
 */
export const FALLBACK_HEADER = "x-cvh-fallback";

/** The part of Storage this uses, so a test can pass a plain object. */
export type KeptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export type KeptListing = {
  listing: DirectoryListingV1;
  /** When the release was published (the manifest's `published_at`), for "Last updated {time}". */
  publishedAt: string;
};

export type DirectoryState =
  | { status: "loading" }
  /** `current`: the manifest confirmed that this is the release the server names. Not current: a kept release the manifest has not (yet) confirmed, or the previous complete release because the newer one could not be downloaded or the server could not be asked. */
  | { status: "ready"; listing: DirectoryListingV1; publishedAt: string; current: boolean }
  /** Nothing has ever been kept and nothing could be downloaded. */
  | { status: "unavailable" };

const keyOf = (lang: string) => `${CACHE_PREFIX}${lang}`;

/** A kept listing as the screen shows it until the manifest has confirmed it: never as current. */
export const keptState = (kept: KeptListing): DirectoryState => ({ status: "ready", ...kept, current: false });

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

/** True for the error a full store throws (the standard name, Firefox's own name, and the legacy codes 22 and 1014). */
function isQuotaError(error: unknown): boolean {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
}

/** The keys of the other kept listings (the directory's own, one per language). */
function otherListingKeys(storage: KeptStorage, own: string): string[] {
  const keys: string[] = [];
  for (let at = 0; at < storage.length; at += 1) {
    const key = storage.key(at);
    if (key?.startsWith(CACHE_PREFIX) && key !== own) keys.push(key);
  }
  return keys;
}

/**
 * Keeps a complete listing and drops the kept listings of older releases. A full store makes room once: the other
 * `cvh.directory.*` listings go (each is only a copy of what the server has) and the write is tried again. A store that
 * stays full or is blocked only means nothing is kept.
 */
export function keep(storage: KeptStorage | null, kept: KeptListing): void {
  if (!storage) return;
  const own = keyOf(kept.listing.lang);
  const body = JSON.stringify({ v: 1, publishedAt: kept.publishedAt, listing: kept.listing });
  try {
    try {
      storage.setItem(own, body);
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      for (const other of otherListingKeys(storage, own)) storage.removeItem(other);
      storage.setItem(own, body);
    }
  } catch {
    return;
  }
  try {
    const old: string[] = [];
    for (const other of otherListingKeys(storage, own)) {
      const release = readReleaseOf(storage, other);
      if (release !== null && release < kept.listing.release_v) old.push(other);
    }
    for (const other of old) storage.removeItem(other);
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

export type Fetcher = typeof fetch;

/**
 * Reads one JSON body completely. Null for any failure: no signal, no answer within `timeoutMs`, a refusal, a response a
 * service worker made up (FALLBACK_HEADER), a body that stops short or is not JSON.
 */
export async function readJson(fetcher: Fetcher, url: string, timeoutMs: number): Promise<unknown> {
  try {
    // The signal covers the body too: a download that stalls after the headers is cut off as well.
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await fetcher(url, { credentials: "omit", cache: "no-cache", headers: { Accept: "application/json" }, signal });
    // The whole body is read first, so a refusal does not leave the request open and a download cut short throws here.
    const text = await response.text();
    if (!response.ok) return null;
    // TODO(S02.12): the service worker must answer a failed manifest or listing request from its cache only with this
    // header set (for example `x-cvh-fallback: 1`), never as a plain 200. Without it a stale manifest would look like the
    // server's answer and the screen would call an old release current. Nothing sets it before S02.12; this side is done.
    if (response.headers.get(FALLBACK_HEADER) !== null) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The manifest as the server names it now (never cached), or null when it cannot be read or fails its schema. */
export async function fetchManifest(fetcher: Fetcher, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<DirectoryManifestV1 | null> {
  const manifest = DirectoryManifestV1.safeParse(await readJson(fetcher, MANIFEST_URL, timeoutMs));
  return manifest.success ? manifest.data : null;
}

/**
 * The directory in `lang`. Asks the server which release is current, and:
 * - the kept listing is the manifest's release (same `release_v` and same `catalogue_hash`): it is shown as current;
 * - anything else (nothing kept, an older release, a release the manifest does not name, or the same number made from
 *   another catalogue): the manifest's file is downloaded completely, checked against `DirectoryListingV1` (and against
 *   the manifest: same release, language and catalogue) and only then kept and shown;
 * - the download fails, is incomplete or fails the check, or the server cannot be asked: the kept listing is shown, not
 *   as current, and the next visit tries again (nothing is remembered about the failure);
 * - nothing was ever kept: `unavailable`.
 * `onKept` is called first with the kept listing as a not-current state, so the list can show while the server is asked,
 * and it is not called current until the manifest has confirmed it.
 */
export async function loadDirectory(
  lang: string,
  deps: {
    fetcher?: Fetcher;
    storage?: KeptStorage | null;
    onKept?: (state: DirectoryState) => void;
    /** Told what the manifest said, once: the manifest, or null when it could not be read (the ask screen needs its `search` part). */
    onManifest?: (manifest: DirectoryManifestV1 | null) => void;
    timeoutMs?: number;
  } = {},
): Promise<DirectoryState> {
  const fetcher = deps.fetcher ?? fetch;
  const storage = deps.storage ?? null;
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS;
  const kept = readKept(storage, lang);
  if (kept) deps.onKept?.(keptState(kept));

  const manifest = await fetchManifest(fetcher, timeoutMs);
  deps.onManifest?.(manifest);
  const previous = (): DirectoryState => (kept ? keptState(kept) : { status: "unavailable" });
  if (!manifest) return previous();

  const release = manifest;
  // A kept release is the current one only if it is the manifest's own: a number the manifest does not name (a release that
  // was withdrawn, so the manifest is older) or the same number made from another catalogue is not.
  if (kept && kept.listing.release_v === release.release_v && kept.listing.catalogue_hash === release.catalogue_hash) {
    return { status: "ready", ...kept, current: true };
  }

  const path = release.files[lang as keyof typeof release.files];
  if (!path) return previous();
  const listing = DirectoryListingV1.safeParse(await readJson(fetcher, path, timeoutMs));
  if (!listing.success) return previous();
  const l = listing.data;
  if (l.release_v !== release.release_v || l.lang !== lang || l.catalogue_hash !== release.catalogue_hash) return previous();

  const fresh: KeptListing = { listing: l, publishedAt: release.published_at };
  keep(storage, fresh);
  return { status: "ready", ...fresh, current: true };
}
