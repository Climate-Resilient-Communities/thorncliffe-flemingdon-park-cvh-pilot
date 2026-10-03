// Whether texting is live (S06.07): the one question the on-call approval rule asks. Texting is live when the sender can really send: SMS_MODE is
// `live` (production only, which the environment schema enforces) AND Twilio's account and Messaging Service are set, which is exactly when the
// dispatcher stops refusing to run (`dispatcherConfig` in ./dispatch.ts, `SenderNotConfigured`). Twilio is set up last, so until the owner sets those
// variables in production the rule is off and one Admin can approve alerts; the day they are set, an on-call number is required. Reads no secret
// value: only whether each is set. Pure, so the rule is tested without an environment.
import type { Env } from "@/platform/config/env";

export function textingIsLive(env: Pick<Env, "smsMode" | "twilio">): boolean {
  if (env.smsMode !== "live") return false;
  const twilio = env.twilio;
  return Boolean(twilio?.accountSid && twilio.authToken && twilio.messagingServiceSid);
}
