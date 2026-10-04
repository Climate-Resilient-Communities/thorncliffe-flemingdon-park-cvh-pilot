import { USAGE_BODY_MAX_BYTES, UsageEventSchema, type UsageEvent } from "@/contracts/usage";

// The usage counter (S02.15, AR-26, FR-M1, FR-M3): POST /api/metrics takes one `{evt, lang, nbhd?}` and adds one to the day's count for
// that combination (usage_count). Nothing else is read from the request or kept: this file never touches the request's headers, so the
// address, the user agent and any cookie never enter the app's code, let alone its log or its database. The answer sets no cookie
// and is never cached. A body that is not exactly the event (an unknown event or language, an extra field, more than 256 bytes) is
// refused with 400 and counts nothing.

export interface MetricsDeps {
  /** Adds one to the day's count for the event. May throw. */
  count: (event: UsageEvent) => Promise<void>;
  /** Told that counting failed; it gets nothing about the request. */
  onFailure?: (error: unknown) => void;
}

const HEADERS = { "Cache-Control": "no-store" } as const;
const refused = () => Response.json({ error: "invalid" }, { status: 400, headers: HEADERS });

/** The body's text if it is at most `limit` bytes, otherwise null, without reading on past the limit. */
async function readLimited(request: Request, limit: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

export async function metricsResponse(deps: MetricsDeps, request: Request): Promise<Response> {
  const text = await readLimited(request, USAGE_BODY_MAX_BYTES).catch(() => null);
  if (text === null) return refused();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refused();
  }
  const event = UsageEventSchema.safeParse(body);
  if (!event.success) return refused();
  try {
    await deps.count(event.data);
  } catch (error) {
    deps.onFailure?.(error);
    return Response.json({ error: "unavailable" }, { status: 503, headers: HEADERS });
  }
  return new Response(null, { status: 204, headers: HEADERS });
}
