// Composition root of the provider's status callbacks (S06.04, AD-2, AD-8): the validated environment (the Twilio account's Auth Token,
// which signs every callback, and PUBLIC_BASE_URL, which the signed URL is built from), the app's database and ops' event log. Server
// only. The Auth Token is read here and nowhere else for this purpose, and only to check a signature: it is never logged, returned or
// stored. Where there is no Twilio account (every environment but production) the callbacks have no token to be checked with, so the
// route does nothing at all.
import "server-only";
import { createStatusCallbacks, stdoutMessagingLog, type MessagingLog, type OpsRecorder, type StatusCallbackDeps, type StatusCallbacks } from "@/modules/messaging";
import { getEnv, type Env } from "@/platform/config/env";
import { getDb, type Db } from "@/platform/db";
import { opsRecorder } from "./dispatch";

export interface StatusCallbackParts {
  env?: Pick<Env, "twilio" | "publicBaseUrl">;
  db?: Db;
  ops?: OpsRecorder;
  log?: MessagingLog;
  /** S06.08 passes the same function it gives `appDispatcher`'s `afterOutcome` (see StatusCallbackDeps). */
  afterOutcome?: StatusCallbackDeps["afterOutcome"];
  /** S06.08's matching rule: called when a callback stores the provider id a delivery lacked (see StatusCallbackDeps). */
  afterProviderId?: StatusCallbackDeps["afterProviderId"];
}

/** The status callbacks on the real environment and database (every part can be replaced in a test). */
export function appStatusCallbacks(parts: StatusCallbackParts = {}): StatusCallbacks {
  const env = parts.env ?? getEnv();
  const authToken = env.twilio?.authToken;
  // No Twilio account: nothing can be validated, so nothing is touched, the database included (an environment with no database still answers).
  if (!authToken) return { handle: async () => ({ kind: "not_configured" }) };
  return createStatusCallbacks({
    db: parts.db ?? getDb(),
    ops: parts.ops ?? opsRecorder,
    log: parts.log ?? stdoutMessagingLog,
    authToken,
    publicBaseUrl: env.publicBaseUrl,
    afterOutcome: parts.afterOutcome,
    afterProviderId: parts.afterProviderId,
  });
}
