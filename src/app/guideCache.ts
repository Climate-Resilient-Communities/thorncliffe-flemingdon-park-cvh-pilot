// The cache of the guides and the essential numbers (S02.10). The Be ready pages read both through one cache entry
// with this tag. The seed that loads them (`npm run seed:guides`) is a command run by IT, outside the app, so it cannot
// drop the entry: a reloaded guide or number reaches residents when the entry expires (5 minutes) and a shared cache in
// front of the app lets go of the page (s-maxage=300 plus stale-while-revalidate=60, next.config.ts), so about 6 minutes.
// A guide changes by review and a deliberate seed run, not by the minute, so that delay costs nothing.

/** How long the guides and numbers are kept before they are read again. */
export const GUIDE_REVALIDATE_SECONDS = 300;

export const GUIDE_CONTENT_TAG = "guide-content";

/**
 * The guides a shared cache may keep (next.config.ts): the six the pilot launches with (GUIDE_ORDER in the directory module,
 * which a test keeps equal to this list). A page for any other guide id is a 404 and gets no public cache header, so a
 * shared cache never keeps a 404 for a made-up address, and a guide added later is served fresh until it is added here.
 */
export const SHARED_CACHE_GUIDES = ["power", "flood", "elevator", "heat", "smoke", "fire"] as const;
