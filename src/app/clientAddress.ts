/**
 * The client of a request, for the failed-sign-in throttle: the address Vercel's edge saw
 * (`x-real-ip`, or the first `x-forwarded-for` entry, both set by Vercel and not taken from the
 * client). It is never stored: identity keeps only a keyed hash of it (AD-13). Without either
 * header (local runs) every request is the same client.
 */
export function clientAddress(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}
