// Composition root of the first-text spike (S01.15, AD-2): the validated environment, the app's
// database and Twilio's REST API. Server only. Twilio's credentials and the approved numbers exist
// only in production's variables, so everywhere else this reports a preview and builds nothing that
// could send.
//
// The approved numbers never reach the browser. The page offers each as an opaque, keyed choice (a short
// hash made on the server) with a masked label; the server action resolves the choice again from
// env.smsTestAllowlist and refuses anything that does not resolve.
import {
  createTestText,
  listUnknownAttempts,
  maskedLabels,
  numberChoice,
  numberKeyFromSecret,
  resolveNumberChoice,
  type TestTextService,
  type UnknownAttempt,
} from "@/modules/messaging";
import { getEnv, type Env } from "@/platform/config/env";
import { getDb } from "@/platform/db";

/**
 * Where the page stands:
 *  - `preview`: not production with SMS_MODE=live (a preview, local development, or an environment that
 *    did not validate): "Texts are only sent from production", no button;
 *  - `not_configured`: production and live, but the Twilio account, the toll-free number or the approved
 *    numbers are not set, or one of them is malformed (smsTestProblem): a notice, no button;
 *  - `ready`: the button, with the approved numbers as opaque choices and masked labels (never the numbers).
 */
export type SmsTestAvailability = { kind: "preview" } | { kind: "not_configured" } | { kind: "ready"; numbers: { value: string; label: string }[] };

type SmsEnv = Pick<Env, "environment" | "smsMode" | "twilio" | "smsTestAllowlist"> & Partial<Pick<Env, "smsTestProblem">>;

const isLive = (env: Pick<Env, "environment" | "smsMode">) => env.environment === "production" && env.smsMode === "live";

/** The key the choices are made with (derived from the Twilio auth token, which never leaves the server). */
const choiceKey = (env: SmsEnv): string | undefined => (env.twilio ? numberKeyFromSecret(env.twilio.authToken) : undefined);

export function availabilityOf(env: SmsEnv): SmsTestAvailability {
  if (!isLive(env)) return { kind: "preview" };
  const key = choiceKey(env);
  if (!key || !env.twilio?.fromNumber || env.smsTestAllowlist.length === 0 || env.smsTestProblem !== undefined) return { kind: "not_configured" };
  const labels = maskedLabels(env.smsTestAllowlist);
  return { kind: "ready", numbers: env.smsTestAllowlist.map((number, index) => ({ value: numberChoice(key, number), label: labels[index] })) };
}

/** The approved number a form's choice stands for, or undefined (unknown, tampered, a raw number, or not live here). */
export function resolveChoice(env: SmsEnv, choice: string): string | undefined {
  const key = choiceKey(env);
  if (!isLive(env) || !key || env.smsTestProblem !== undefined) return undefined;
  return resolveNumberChoice(key, env.smsTestAllowlist, choice);
}

/** The page's availability from the real environment; an environment that does not validate counts as a preview (fail closed). */
export function smsTestAvailability(): SmsTestAvailability {
  try {
    return availabilityOf(getEnv());
  } catch {
    return { kind: "preview" };
  }
}

/** The number behind the form's choice, resolved on the server from the real environment; undefined when it resolves to none. */
export function resolveSmsTestChoice(choice: string): string | undefined {
  try {
    return resolveChoice(getEnv(), choice);
  } catch {
    return undefined;
  }
}

/** Attempts claimed more than a minute ago whose answer was never recorded; none where there is no database. */
export async function smsTestUnknownAttempts(): Promise<UnknownAttempt[]> {
  try {
    return await listUnknownAttempts(getDb());
  } catch {
    return [];
  }
}

/** The use case on the real environment. Throws where the environment or the database is not available. */
export function smsTestService(): TestTextService {
  const env = getEnv();
  const live = isLive(env) && env.smsTestProblem === undefined;
  return createTestText({
    db: getDb(),
    config: { live, allowlist: live ? env.smsTestAllowlist : [], fromNumber: live ? env.twilio?.fromNumber : undefined },
    twilio: live && env.twilio ? { accountSid: env.twilio.accountSid, authToken: env.twilio.authToken } : undefined,
  });
}
