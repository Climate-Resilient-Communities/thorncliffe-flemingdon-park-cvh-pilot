// The first-text spike's rules (S01.15; E06 removes the spike when the outbound queue replaces it):
// what is sent, to whom, and what counts as a duplicate. No I/O and no clock: the use case
// (../application/sendTestText.ts) asks, with the time it read.

/** The one text the spike sends, word for word. */
export const TEST_TEXT_BODY = "CVH test from production";

/** A second text to the same number within this long is refused as a duplicate. */
export const DUPLICATE_WINDOW_MS = 5 * 60_000;

/** An E.164 number: "+", a non-zero country code digit, then up to 14 more digits. */
const E164 = /^\+[1-9][0-9]{7,14}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isE164(value: unknown): value is string {
  return typeof value === "string" && E164.test(value);
}

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** True only for a number that is exactly one of the approved ones (no normalising, no prefix match). */
export function isAllowlisted(allowlist: readonly string[], number: string): boolean {
  return allowlist.includes(number);
}

/** A number as the screen names it, with all but its last four digits hidden: `+1 ••• ••• 0101`. */
export function maskNumber(number: string): string {
  const digits = number.slice(1);
  const tail = digits.slice(-4);
  const country = digits.length > 10 ? digits.slice(0, digits.length - 10) : "";
  return `+${country}${country ? " " : ""}••• ••• ${tail}`;
}

/**
 * The screen's labels for a list of numbers: each masked, and made unique when masks collide (two numbers that end
 * in the same four digits), so the person can tell the choices apart: `+1 ••• ••• 0101`, `+1 ••• ••• 0101 (2)`.
 */
export function maskedLabels(numbers: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return numbers.map((number) => {
    const mask = maskNumber(number);
    const count = (seen.get(mask) ?? 0) + 1;
    seen.set(mask, count);
    return count === 1 ? mask : `${mask} (${count})`;
  });
}

/**
 * Why a press of "Send test text" was refused before the provider was called:
 *  - `invalid`: the request id or the number is not well formed;
 *  - `not_available`: this is not production with SMS_MODE live, or Twilio's account or number is not set;
 *  - `not_allowlisted`: the number is not one of SMS_TEST_ALLOWLIST;
 *  - `duplicate_number`: a text to this number was claimed within the last 5 minutes;
 *  - `duplicate_request`: this request id was used before.
 */
export type TestTextRefusal = "invalid" | "not_available" | "not_allowlisted" | "duplicate_number" | "duplicate_request";

/** The refusal reason the audit trail records for each refusal (the audit module's catalogue). */
export const AUDIT_REASON_OF: Record<TestTextRefusal, "validation" | "not_available" | "not_allowlisted" | "duplicate"> = {
  invalid: "validation",
  not_available: "not_available",
  not_allowlisted: "not_allowlisted",
  duplicate_number: "duplicate",
  duplicate_request: "duplicate",
};
