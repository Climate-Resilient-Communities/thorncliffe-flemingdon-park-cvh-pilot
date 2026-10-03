/**
 * Twilio's webhook signature (S06.04, AD-20 "Webhooks"): the check every Twilio webhook of the app makes before it does any work
 * (the status callbacks here, the inbound messages of S07.04). Pure: the token, the URL and the parameters are given.
 *
 * Twilio's documented algorithm (https://www.twilio.com/docs/usage/security#validating-requests):
 *  1. take the full URL Twilio was configured to call, from the protocol through the end of the query string;
 *  2. for a POST, sort the form parameters by name (case-sensitive, code unit order);
 *  3. append each name and value to the URL with no delimiter (a name sent more than once contributes each distinct value, sorted,
 *     as Twilio's own helper library does);
 *  4. sign that string with HMAC-SHA1, keyed by the account's Auth Token;
 *  5. base64-encode the digest: that is the `X-Twilio-Signature` header.
 *
 * The URL is the one the app itself gave Twilio (`PUBLIC_BASE_URL` plus the path and query the dispatcher sent, never the host header
 * of the request, which a proxy can change), so the check also proves the request is for that exact delivery reference.
 * twilioSignature.test.ts holds the documented vector and a cross-check against the official library's helper.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** The parameters of a form body, in the order they were sent (a name may repeat). */
export type FormParameters = readonly (readonly [name: string, value: string])[];

/** The text Twilio signs: the URL, then each sorted parameter's name and value. */
function signedText(url: string, params: FormParameters): string {
  const byName = new Map<string, Set<string>>();
  for (const [name, value] of params) {
    const values = byName.get(name);
    if (values) values.add(value);
    else byName.set(name, new Set([value]));
  }
  let text = url;
  for (const name of [...byName.keys()].sort()) {
    for (const value of [...(byName.get(name) as Set<string>)].sort()) text += name + value;
  }
  return text;
}

/** The signature Twilio computes for this request: base64 of HMAC-SHA1 over the URL and the sorted parameters, keyed by the Auth Token. */
export function expectedTwilioSignature(authToken: string, url: string, params: FormParameters): string {
  return createHmac("sha1", authToken).update(Buffer.from(signedText(url, params), "utf-8")).digest("base64");
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Whether `signature` (the header's value, null when it is absent) is the signature of this request. The comparison is constant-time
 * (a digest of each side, so neither the length nor the first differing byte shows in the time taken), and an absent or empty header
 * is never valid, whatever the token.
 */
export function isValidTwilioSignature(authToken: string, signature: string | null, url: string, params: FormParameters): boolean {
  if (signature === null || signature === "" || authToken === "") return false;
  return timingSafeEqual(digest(expectedTwilioSignature(authToken, url, params)), digest(signature));
}
