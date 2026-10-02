// Composition root of the first-text spike (S01.15, AD-2): the validated environment, the app's
// database and Twilio's REST API. Server only. Twilio's credentials and the approved numbers exist
// only in production's variables, so everywhere else this reports a preview and builds nothing that
// could send.
import { createTestText, maskNumber, type TestTextService } from "@/modules/messaging";
import { getEnv, type Env } from "@/platform/config/env";
import { getDb } from "@/platform/db";

/**
 * Where the page stands:
 *  - `preview`: not production with SMS_MODE=live (a preview, local development, or an environment that
 *    did not validate): "Texts are only sent from production", no button;
 *  - `not_configured`: production and live, but the Twilio account, the toll-free number or the approved
 *    numbers are not set: a notice, no button;
 *  - `ready`: the button, with the approved numbers (masked for the screen).
 */
export type SmsTestAvailability = { kind: "preview" } | { kind: "not_configured" } | { kind: "ready"; numbers: { value: string; label: string }[] };

export function availabilityOf(env: Pick<Env, "environment" | "smsMode" | "twilio" | "smsTestAllowlist">): SmsTestAvailability {
  if (env.environment !== "production" || env.smsMode !== "live") return { kind: "preview" };
  if (!env.twilio?.fromNumber || env.smsTestAllowlist.length === 0) return { kind: "not_configured" };
  return { kind: "ready", numbers: env.smsTestAllowlist.map((value) => ({ value, label: maskNumber(value) })) };
}

/** The page's availability from the real environment; an environment that does not validate counts as a preview (fail closed). */
export function smsTestAvailability(): SmsTestAvailability {
  try {
    return availabilityOf(getEnv());
  } catch {
    return { kind: "preview" };
  }
}

/** The use case on the real environment. Throws where the environment or the database is not available. */
export function smsTestService(): TestTextService {
  const env = getEnv();
  const live = env.environment === "production" && env.smsMode === "live";
  return createTestText({
    db: getDb(),
    config: { live, allowlist: live ? env.smsTestAllowlist : [], fromNumber: live ? env.twilio?.fromNumber : undefined },
    twilio: live && env.twilio ? { accountSid: env.twilio.accountSid, authToken: env.twilio.authToken } : undefined,
  });
}
