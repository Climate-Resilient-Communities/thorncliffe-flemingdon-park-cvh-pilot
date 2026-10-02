import { unstable_cache } from "next/cache";
import { FEED_TAG, FeedErrorV1, FeedV1 } from "@/contracts/feed";
import { LangCodeSchema, type LangCode } from "@/contracts/lang";
import { readFeed } from "./source";

// The public alert feed (AD-17, S02.11): FeedV1, owned by the alerting module, the same for every visitor and every
// device (AD-3). It reads no cookie, sets none, and takes nothing from the request but the page language. The only
// query value is `lang`; the building, floor and groups a resident chose never come here, because the phone picks its
// own buildings out of the whole-neighbourhood answer.
//
// Edge-cached for 15 seconds (`s-maxage`), and kept for the same 15 seconds in Next's data cache under the tag `feed`,
// which every transaction that changes web-visible state drops after it commits (S04.08). The browser asks again
// itself every 60 seconds. A failure is thrown out of the cached function, so it is never cached.
export const dynamic = "force-dynamic";

const FEED_REVALIDATE_SECONDS = 15;
const PUBLIC_CACHE = `public, max-age=0, s-maxage=${FEED_REVALIDATE_SECONDS}`;

const readCached = (lang: LangCode) =>
  unstable_cache(() => readFeed(lang), ["feed", lang], { revalidate: FEED_REVALIDATE_SECONDS, tags: [FEED_TAG] })();

const failure = (status: number, code: "LANG_INVALID" | "FEED_UNAVAILABLE") =>
  Response.json(FeedErrorV1.parse({ error: { code, message_key: code === "LANG_INVALID" ? "feed.langInvalid" : "feed.unavailable" } }), {
    status,
    headers: { "Cache-Control": "no-store" },
  });

export async function GET(request: Request) {
  const lang = LangCodeSchema.safeParse(new URL(request.url).searchParams.get("lang"));
  if (!lang.success) return failure(400, "LANG_INVALID");
  try {
    return Response.json(FeedV1.parse(await readCached(lang.data)), { headers: { "Cache-Control": PUBLIC_CACHE } });
  } catch {
    // An expected failure as a value: the phone keeps what it has and says it could not check.
    return failure(503, "FEED_UNAVAILABLE");
  }
}
