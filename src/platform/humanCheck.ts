// The human check on the two public forms that a script could fill in: text sign-up (POST /api/signup) and a suggestion of a place
// (POST /api/places/submissions). Resident testing, session 2 (#2, #12): "Missing privacy-preserving human action verification".
//
// It is Cloudflare Turnstile, and it is OFF unless both keys are set:
//   TURNSTILE_SITE_KEY    public; the form's widget uses it (passed to the page from the server, not a NEXT_PUBLIC_ variable)
//   TURNSTILE_SECRET_KEY  secret; the server checks the widget's token with it. Never printed, never sent to the browser.
// With one of them missing, the forms show no widget, the server asks for no token, and the CSP allows no Cloudflare origin. The rate
// limits (and the places form's honeypot) are the protection then, as before.
//
// Privacy (AD-3): the token is sent to Cloudflare's siteverify with the secret and nothing else. The client's address is not sent (the
// optional `remoteip` is left out), and nothing about the check is stored or logged beyond its outcome. The widget itself runs in the
// resident's browser and talks to Cloudflare, which is why it is off until the Hub decides to turn it on.
//
// When Cloudflare cannot be reached or answers with something unreadable, the form goes through ("unavailable"): a resident must never be
// kept from emergency alerts because a third party is down. Only a definite "this token is not valid" refuses.

import { TURNSTILE_ORIGIN } from "../contracts/humanCheck";

const SITEVERIFY = `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`;
const TIMEOUT_MS = 5000;

export interface HumanCheckConfig {
  siteKey: string;
  secret: string;
}

/** The keys from the environment, or null (the check is off) unless both are set to something. */
export function readHumanCheckConfig(env: Record<string, string | undefined> = process.env): HumanCheckConfig | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  return siteKey && secret ? { siteKey, secret } : null;
}

/** The site key a page gives its form, or null when the check is off. */
export const humanCheckSiteKey = (env: Record<string, string | undefined> = process.env): string | null => readHumanCheckConfig(env)?.siteKey ?? null;

/** "off": no keys. "passed": Cloudflare says the token is good. "failed": no token, or Cloudflare says it is not good. "unavailable": no answer. */
export type HumanCheckOutcome = "off" | "passed" | "failed" | "unavailable";

export async function checkHuman(config: HumanCheckConfig | null, token: string | undefined, fetcher: typeof fetch = fetch): Promise<HumanCheckOutcome> {
  if (!config) return "off";
  if (!token) return "failed";
  try {
    const response = await fetcher(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: config.secret, response: token }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return "unavailable";
    const answer = (await response.json()) as { success?: unknown; "error-codes"?: unknown };
    if (answer.success === true) return "passed";
    if (answer.success !== false) return "unavailable";
    // A secret Cloudflare does not know is our misconfiguration, not the resident's: let the form through.
    const codes = Array.isArray(answer["error-codes"]) ? answer["error-codes"] : [];
    if (codes.includes("missing-input-secret") || codes.includes("invalid-input-secret") || codes.includes("internal-error")) return "unavailable";
    return "failed";
  } catch {
    return "unavailable";
  }
}
