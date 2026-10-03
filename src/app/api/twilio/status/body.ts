// The request body of a Twilio webhook, read with a limit (S06.04). A status callback is a small form (a few hundred bytes); the
// route is public, so it never reads more than MAX_CALLBACK_BODY_BYTES before it has checked the signature.

/** Far above any status callback Twilio sends (its parameters are short), far below what could cost anything to read. */
export const MAX_CALLBACK_BODY_BYTES = 64 * 1024;

/**
 * The body as text, or null when it is longer than `maxBytes` (declared by `Content-Length`, or found while reading: a body with no
 * declared length is cut off at the limit, not read to the end).
 */
export async function readBodyWithin(request: Request, maxBytes: number = MAX_CALLBACK_BODY_BYTES): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^[0-9]+$/.test(declared) && Number(declared) > maxBytes) return null;
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
