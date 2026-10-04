import { ARCHIVE_EDGE_MAX_AGE_SECONDS, ARCHIVE_MAX_PAGE, ArchiveV1, FeedErrorV1 } from "@/contracts/feed";
import { LangCodeSchema } from "@/contracts/lang";
import { readCachedArchive } from "@/app/feedCache";
import { logFeedReadFailed } from "../log";

// The archive (S05.07, R-08): the non-drill threads that closed, newest closed first, 20 to a page, each as the feed shows it when live. The same for every visitor and every
// device (AD-3): it reads no cookie, sets none, and takes nothing from the request but the page language and the page number (`lang`, and `page`, 1-based, default 1; any
// other parameter is refused, as on the feed, so the shared cache cannot be fragmented). Edge-cached for at most 60 seconds (`s-maxage`), and kept in the app's data cache under the
// feed's tag (src/app/feedCache.ts), so closing a thread expires it with the feed. With the launch gate off it lists no thread.
export const dynamic = "force-dynamic";

const PUBLIC_CACHE = `public, max-age=0, s-maxage=${ARCHIVE_EDGE_MAX_AGE_SECONDS}`;

const MESSAGE_KEYS = { LANG_INVALID: "feed.langInvalid", query_invalid: "feed.queryInvalid", FEED_UNAVAILABLE: "feed.unavailable" } as const;

const failure = (status: number, code: keyof typeof MESSAGE_KEYS) =>
  Response.json(FeedErrorV1.parse({ v: 1, error: { code, message_key: MESSAGE_KEYS[code] } }), {
    status,
    headers: { "Cache-Control": "no-store" },
  });

/** `page` as a whole number from 1 to ARCHIVE_MAX_PAGE, written plainly (no sign, no leading zero, no fraction); absent is page 1; anything else is null. */
function pageOf(raw: string | null): number | null {
  if (raw === null) return 1;
  if (!/^[1-9][0-9]{0,3}$/.test(raw)) return null;
  const page = Number(raw);
  return page <= ARCHIVE_MAX_PAGE ? page : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lang = LangCodeSchema.safeParse(searchParams.get("lang"));
  if (!lang.success) return failure(400, "LANG_INVALID");
  const page = pageOf(searchParams.get("page"));
  if (page === null || [...searchParams.keys()].some((key) => key !== "lang" && key !== "page") || searchParams.getAll("page").length > 1) return failure(400, "query_invalid");
  try {
    return Response.json(ArchiveV1.parse(await readCachedArchive(lang.data, page)), { headers: { "Cache-Control": PUBLIC_CACHE } });
  } catch (error) {
    logFeedReadFailed(lang.data, error);
    return failure(503, "FEED_UNAVAILABLE");
  }
}
