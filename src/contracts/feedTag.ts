// The cache tag of the resident feed (AD-17). Every transaction that changes what the web shows increments `alerting.feed_version`
// and, once it has committed, calls `revalidateTag(FEED_TAG, { expire: 0 })`, so the edge-cached `/api/feed` is read again at once
// instead of after its 15 seconds. The feed route tags what it caches with this value (S02.11 builds `/api/feed`; its contract file,
// src/contracts/feed.ts, uses this constant rather than writing "feed" again). Pure and browser-safe.
export const FEED_TAG = "feed";
