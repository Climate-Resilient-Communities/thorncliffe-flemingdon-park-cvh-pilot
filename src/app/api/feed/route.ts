import { unstable_cache } from "next/cache";
import { FEED_TAG, FeedErrorV1, FeedV1 } from "@/contracts/feed";
import { LangCodeSchema, type LangCode } from "@/contracts/lang";
import { logFeedReadFailed } from "./log";
import { readFeed } from "./source";

// The public alert feed (AD-17, S02.11): FeedV1, owned by the alerting module, the same for every visitor and every
// device (AD-3). It reads no cookie, sets none, and takes nothing from the request but the page language. The only
// query value is `lang`; the building, floor and groups a resident chose never come here, because the phone picks its
// own buildings out of the whole-neighbourhood answer.
//
// Edge-cached for 15 seconds (`s-maxage`), and kept in Next's data cache under FEED_TAG with `revalidate: 15`. The data
// cache stays because the read is not one row: the feed version, the 43 buildings and (from S04.08) the open threads and
// the statuses derived from them, for each of the languages. Time-based revalidation is stale-while-revalidate: once the 15
// seconds have passed the next request is still answered from the old entry while a new one is built, so on time alone the
// answer can be about 30 seconds old on top of the edge's 15. A publisher therefore expires the tag, which makes the next
// request wait for a fresh read: `revalidateTag(FEED_TAG, { expire: 0 })`, as every transaction that changes web-visible
// state must do after it commits (S04.08). Plain `revalidateTag(FEED_TAG)` only marks the entry stale. The edge's 15
// seconds cannot be dropped by tag and are the most a resident waits after that. The browser asks again itself every 60
// seconds. A failure is thrown out of the cached function, so it is never cached.
export const dynamic = "force-dynamic";

const FEED_REVALIDATE_SECONDS = 15;
const PUBLIC_CACHE = `public, max-age=0, s-maxage=${FEED_REVALIDATE_SECONDS}`;

const readCached = (lang: LangCode) =>
  unstable_cache(() => readFeed(lang), ["feed", lang], { revalidate: FEED_REVALIDATE_SECONDS, tags: [FEED_TAG] })();

const MESSAGE_KEYS = { LANG_INVALID: "feed.langInvalid", query_invalid: "feed.queryInvalid", FEED_UNAVAILABLE: "feed.unavailable" } as const;

const failure = (status: number, code: keyof typeof MESSAGE_KEYS) =>
  Response.json(FeedErrorV1.parse({ v: 1, error: { code, message_key: MESSAGE_KEYS[code] } }), {
    status,
    headers: { "Cache-Control": "no-store" },
  });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lang = LangCodeSchema.safeParse(searchParams.get("lang"));
  if (!lang.success) return failure(400, "LANG_INVALID");
  // Nothing but `lang` is accepted: another parameter would be a way to fragment the shared cache or to carry something
  // about the resident, so it is refused, with its own code when the language itself is fine.
  if ([...searchParams.keys()].some((key) => key !== "lang")) return failure(400, "query_invalid");
  try {
    return Response.json(FeedV1.parse(await readCached(lang.data)), { headers: { "Cache-Control": PUBLIC_CACHE } });
  } catch (error) {
    // An expected failure as a value: the phone keeps what it has and says it could not check.
    logFeedReadFailed(lang.data, error);
    return failure(503, "FEED_UNAVAILABLE");
  }
}
