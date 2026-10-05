// The release files for a cold search instance, from Next's data cache (Vercel Data Cache in production) instead of the private
// Supabase Storage bucket: the first instance after a publish downloads vectors.bin and the English listing and every cold
// instance after it reads them from the cache, with no fresh connection to Storage. Server only.
//
// Why this cannot serve a stale or wrong release:
//  - a release's files never change (a database trigger refuses it), and an entry is named by the release number, the file's path
//    and the sha256 the release record gives it, so a newer release reads entries of its own;
//  - which release is current is still read from the database by every cold instance (the search's snapshot read), never cached here;
//  - the search checks the sha256 of every byte it gets from here against the release record, and bypasses the cache if it differs;
//  - the entry is only stored when the load from Storage hashed correctly (the search's load callback refuses otherwise);
//  - a publish expires DIRECTORY_RELEASE_TAG (src/app/staff/directory/actions.ts), so even a reused number would read afresh.
//
// Size: Vercel Data Cache is ASSUMED to keep an item of at most 2 MB (not yet checked against a real deployment). Bytes are stored as base64 text (4/3 of their size), so a file is cached
// when its base64 fits MAX_CACHED_BASE64_CHARS; a larger one is read from Storage as before (never an error). At the pilot's 99
// providers x 1536 dims of Float32, vectors.bin is about 0.6 MB (0.8 MB as base64): it fits.
import "server-only";
import { unstable_cache } from "next/cache";
import type { ReleaseFileCache } from "@/modules/directory";

/** Expired by the publish; every entry carries it, and `${tag}-<release>` too. */
export const DIRECTORY_RELEASE_TAG = "directory-release";
/** The assumed Vercel Data Cache item limit (2 MB, unverified), less a margin for the entry's own framing, in characters of base64. */
export const MAX_CACHED_BASE64_CHARS = 2 * 1024 * 1024 - 8 * 1024;
/** How long an entry lives before the cache rebuilds it; a release's files are immutable, so this only bounds what a retired release keeps. */
const REVALIDATE_SECONDS = 7 * 24 * 60 * 60;

class TooLargeToCache extends Error {}

export const releaseFileCache: ReleaseFileCache = {
  async read(key, load) {
    let fresh: Uint8Array | undefined;
    try {
      const encoded = await unstable_cache(
        async () => {
          fresh = await load();
          const base64 = Buffer.from(fresh).toString("base64");
          if (base64.length > MAX_CACHED_BASE64_CHARS)
            throw new TooLargeToCache();
          return base64;
        },
        ["directory-release-file", String(key.release), key.sha256, key.path],
        {
          revalidate: REVALIDATE_SECONDS,
          tags: [
            DIRECTORY_RELEASE_TAG,
            `${DIRECTORY_RELEASE_TAG}-${key.release}`,
          ],
        },
      )();
      return new Uint8Array(Buffer.from(encoded, "base64"));
    } catch (error) {
      // Too big for the cache: the bytes were just loaded from Storage; use them.
      if (error instanceof TooLargeToCache && fresh) return fresh;
      throw error;
    }
  },
};
