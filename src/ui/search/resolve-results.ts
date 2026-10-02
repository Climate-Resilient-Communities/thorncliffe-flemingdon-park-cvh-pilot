import { DirectoryListingV1, listingPath, type DirectoryManifestV1, type ListingProvider } from "@/contracts/directory";
import type { SearchV1 } from "@/contracts/searchTestSet";
import { isLaunchCode } from "@/i18n/languages";
import { fetchManifest, keep, readJson, readKept, FETCH_TIMEOUT_MS, type Fetcher, type KeptStorage } from "../directory/load-directory";

// From the ids of an answer to the listings a resident reads (S03.06, AD-11, AD-20). The server returns provider ids and
// the number of the release it searched; the text of every listing comes from the published listing file of exactly that
// release, in the language the question was written in. Nothing the server says is shown except through that file.

export type ResolvedResults =
  | {
      kind: "results";
      /** The providers of the answer, in the order the server returned them. */
      providers: ListingProvider[];
      /** The listing they come from: its `categories` name their topics. */
      listing: DirectoryListingV1;
      /** The language the listings are shown in: the question's own language when its file could be had, otherwise the page language. */
      shownLang: string;
      /** True when the results are not in the language the page is in, so the screen says which language they are in. */
      note: boolean;
    }
  /** The release the answer names could not be made ready on this phone (the manifest or the listing file could not be downloaded): the screen asks the resident to try again. */
  | { kind: "updating" };

export type ResolveDeps = {
  /** The page language. */
  lang: string;
  /** The `v` the question was sent with: the release the phone held, or undefined when it held none. */
  heldRelease: number | undefined;
  fetcher?: Fetcher;
  storage?: KeptStorage | null;
  timeoutMs?: number;
};

/**
 * The listing file of one language for exactly `release`: the kept one when it is that release, otherwise downloaded (the
 * file of a release never changes, so the address names it for good), checked against its schema, language and release,
 * and against the manifest when the manifest names the same release. A newer file than the kept one replaces it; an older
 * one never does (the directory shows the current release).
 */
async function listingOf(release: number, lang: string, deps: ResolveDeps, manifest: DirectoryManifestV1 | null): Promise<DirectoryListingV1 | null> {
  const storage = deps.storage ?? null;
  const manifestHash = manifest?.release_v === release ? manifest.catalogue_hash : null;
  const kept = readKept(storage, lang);
  if (kept && kept.listing.release_v === release && (manifestHash === null || kept.listing.catalogue_hash === manifestHash)) return kept.listing;
  const parsed = DirectoryListingV1.safeParse(await readJson(deps.fetcher ?? fetch, listingPath(release, lang), deps.timeoutMs ?? FETCH_TIMEOUT_MS));
  if (!parsed.success) return null;
  const listing = parsed.data;
  if (listing.release_v !== release || listing.lang !== lang) return null;
  if (manifestHash !== null && listing.catalogue_hash !== manifestHash) return null;
  // It is kept only when the moment the release was published is known (the manifest's, or the one kept with the same
  // release in the page language), so "Last updated" never tells a made-up time.
  const ofPage = readKept(storage, deps.lang);
  const publishedAt = manifest?.release_v === release ? manifest.published_at : ofPage?.listing.release_v === release ? ofPage.publishedAt : null;
  if (publishedAt !== null && (!kept || kept.listing.release_v <= release)) keep(storage, { listing, publishedAt });
  return listing;
}

/**
 * Makes the listings an `ok` answer names ready:
 * - the phone's `v` is older than the answer's `release_v` (or it held none): the manifest is read again first, and if that
 *   fails nothing is shown but "being updated";
 * - the listing file of `query_lang` for exactly `release_v` is the one the ids are looked up in, downloaded if the phone
 *   does not have it; if that fails, the page language's file of the same release is used and the screen says so;
 * - if neither can be had, "being updated".
 * An id the file does not hold is left out; if none is held it is "being updated" too, never a blank list.
 */
export async function resolveResults(answer: SearchV1, deps: ResolveDeps): Promise<ResolvedResults> {
  let manifest: DirectoryManifestV1 | null = null;
  if (deps.heldRelease === undefined || answer.release_v > deps.heldRelease) {
    manifest = await fetchManifest(deps.fetcher ?? fetch, deps.timeoutMs ?? FETCH_TIMEOUT_MS);
    if (!manifest) return { kind: "updating" };
  }

  // A question language the resident app has no page for (zh-Hant) is shown in the page language, as before.
  const queryLang: string = isLaunchCode(answer.query_lang) ? answer.query_lang : deps.lang;
  const wanted = queryLang === deps.lang ? [deps.lang] : [queryLang, deps.lang];
  for (const lang of wanted) {
    const listing = await listingOf(answer.release_v, lang, deps, manifest);
    if (!listing) continue;
    const byId = new Map(listing.providers.map((provider) => [provider.id, provider]));
    const providers = answer.results.map((result) => byId.get(result.provider_id)).filter((provider): provider is ListingProvider => provider !== undefined);
    if (providers.length === 0) return { kind: "updating" };
    return { kind: "results", providers, listing, shownLang: lang, note: queryLang !== deps.lang };
  }
  return { kind: "updating" };
}
