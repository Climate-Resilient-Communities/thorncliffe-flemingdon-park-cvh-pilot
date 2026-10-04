// The Twilio adapter of the sender (S06.02): one POST to the Messages resource through the Messaging Service, with `fetch`, no
// SDK. It is the only code that submits a text to a provider and the only code that reads Twilio's credentials for the sender.
// It sends once and never retries (a retry could send a second text); whatever happens is returned as data, classified by the
// one question the dispatcher cares about: did any of the request leave this machine?
//  - a connection that failed before it could carry the request (refused, no such host, unreachable network, a connect timeout,
//    a failed TLS handshake) is `not_sent`, and only that (and HTTP 429) is ever retried;
//  - anything after the request may have been sent (a timeout, a dropped connection, a response that cannot be read, an
//    acceptance whose body then fails) is `no_answer`: the text may or may not have gone, so it is never sent again.
// Every request sets `SmartEncoded=false` (AD-21: the frozen body is sent byte for byte, with no character replaced), whatever the
// caller does, and carries the status callback URL the caller gives. The credentials are used only in the Authorization header:
// they are never put in a URL, a log line or an error, and an error's message is masked before it goes anywhere.
import type { AbuseSettingsReading, MessageSubmission, MessageSubmitter, MessagingServiceReader } from "../application/dispatcherPorts";
import { PROVIDER_TIMEOUT_MS, type NoAnswerReason, type NotSentReason, type SubmitAnswer } from "../domain/dispatchRules";
import { maskPhoneNumbers } from "../domain/phoneNumber";

export interface TwilioServiceConfig {
  accountSid: string;
  authToken: string;
  /** Twilio's API origin; a test seam (default https://api.twilio.com). */
  baseUrl?: string;
  /** The Messaging API's origin, for reading the service's settings; a test seam (default https://messaging.twilio.com). */
  messagingBaseUrl?: string;
  /** A test seam (default the global fetch). */
  fetch?: typeof fetch;
  /**
   * How long to wait for Twilio's answer once the request is sent. The default for a text is PROVIDER_TIMEOUT_MS (8 seconds), which
   * the run's margin covers (so a send that starts as late as it may ends inside the run's time limit); reading the service's
   * settings, a daily job with no such limit, waits up to 15 seconds.
   */
  timeoutMs?: number;
}

const MESSAGE_SID = /^(SM|MM)[0-9a-f]{32}$/;
const SERVICE_SID = /^MG[0-9a-f]{32}$/;
const STATUS_WORD = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_MESSAGE_LENGTH = 300;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The error code of a failed `fetch`: undici puts it on the error's `cause` (`TypeError: fetch failed`, cause `ECONNREFUSED`). */
function codeOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && isRecord(current); depth += 1) {
    if (typeof current.code === "string") return current.code;
    current = current.cause;
  }
  return undefined;
}

const nameOf = (error: unknown) => (isRecord(error) && typeof error.name === "string" ? error.name : undefined);

const TLS_FAILURES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** The reason no byte of the request was sent, from an error that can only come before the request is written; undefined for any other error. */
export function notSentReason(error: unknown): NotSentReason | undefined {
  const code = codeOf(error);
  if (code === undefined) return undefined;
  if (code === "ECONNREFUSED") return "connection_refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "host_not_found";
  if (code === "ENETUNREACH" || code === "EHOSTUNREACH") return "network_unreachable";
  if (code === "UND_ERR_CONNECT_TIMEOUT") return "connect_timeout";
  if (TLS_FAILURES.has(code) || code.startsWith("ERR_SSL_")) return "tls_failed";
  return undefined;
}

/** Why a request that may have been sent got no answer. */
function noAnswerReason(error: unknown): NoAnswerReason {
  const name = nameOf(error);
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  return "connection_lost";
}

async function jsonOf(response: Response): Promise<{ kind: "body"; body: unknown } | { kind: "unreadable"; error: unknown }> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { kind: "unreadable", error };
  }
  try {
    return { kind: "body", body: JSON.parse(text) as unknown };
  } catch {
    return { kind: "body", body: null };
  }
}

const basicAuth = (config: TwilioServiceConfig) => `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`;

export function twilioMessageSubmitter(config: TwilioServiceConfig): MessageSubmitter {
  const base = (config.baseUrl ?? "https://api.twilio.com").replace(/\/+$/, "");
  const doFetch = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? PROVIDER_TIMEOUT_MS;

  return {
    async submit(submission: MessageSubmission): Promise<SubmitAnswer> {
      let response: Response;
      try {
        response = await doFetch(`${base}/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: basicAuth(config),
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            To: submission.to,
            Body: submission.body,
            MessagingServiceSid: submission.messagingServiceSid,
            StatusCallback: submission.statusCallback,
            SmartEncoded: "false",
          }).toString(),
          // Never follow a redirect with the credentials.
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const reason = notSentReason(error);
        return reason ? { kind: "not_sent", reason } : { kind: "no_answer", reason: noAnswerReason(error) };
      }

      const read = await jsonOf(response);
      if (response.ok) {
        // The status line said yes; a body that cannot be read after it is an acceptance followed by a failure.
        if (read.kind === "unreadable") {
          const dropped = noAnswerReason(read.error) === "timeout" || codeOf(read.error) !== undefined || nameOf(read.error) === "TypeError";
          return { kind: "no_answer", reason: dropped ? "accepted_then_dropped" : "accepted_then_error" };
        }
        const body = read.body;
        const sid = isRecord(body) ? body.sid : undefined;
        const status = isRecord(body) && typeof body.status === "string" ? body.status.toLowerCase().replace(/[^a-z0-9_]/g, "_") : "";
        // A 2xx without a message id is not a text we can account for: it may have been taken, so it is not `accepted`.
        if (typeof sid !== "string" || !MESSAGE_SID.test(sid)) return { kind: "no_answer", reason: "unusable_response" };
        return { kind: "accepted", httpStatus: response.status, status: STATUS_WORD.test(status) ? status : "unknown", messageId: sid };
      }

      const body = read.kind === "body" ? read.body : null;
      const code = isRecord(body) && typeof body.code === "number" && Number.isInteger(body.code) && body.code >= 0 && body.code <= 999_999 ? body.code : null;
      // Twilio's error messages can quote the number ("The 'To' number +14165550101 is not a valid phone number."): masked here,
      // so the answer never carries a whole number.
      const message = isRecord(body) && typeof body.message === "string" && body.message.trim() !== "" ? maskPhoneNumbers(body.message.trim()).slice(0, MAX_MESSAGE_LENGTH) : null;
      return { kind: "rejected", httpStatus: Math.min(Math.max(response.status, 100), 599), errorCode: code, message };
    },
  };
}

export function twilioMessagingServiceReader(config: TwilioServiceConfig): MessagingServiceReader {
  const base = (config.messagingBaseUrl ?? "https://messaging.twilio.com").replace(/\/+$/, "");
  const doFetch = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;

  /** One GET of the service resource: its fields, or why they could not be read (a code). */
  async function readService(messagingServiceSid: string): Promise<{ kind: "fields"; fields: Record<string, unknown> } | { kind: "unreadable"; reason: string }> {
    if (!SERVICE_SID.test(messagingServiceSid)) return { kind: "unreadable", reason: "service_sid_invalid" };
    let response: Response;
    try {
      response = await doFetch(`${base}/v1/Services/${messagingServiceSid}`, {
        method: "GET",
        headers: { Authorization: basicAuth(config), Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { kind: "unreadable", reason: "unreachable" };
    }
    if (!response.ok) return { kind: "unreadable", reason: `http_${Math.min(Math.max(response.status, 100), 599)}` };
    const read = await jsonOf(response);
    return { kind: "fields", fields: read.kind === "body" && isRecord(read.body) ? read.body : {} };
  }

  return {
    async readSmartEncoding(messagingServiceSid) {
      const service = await readService(messagingServiceSid);
      if (service.kind === "unreadable") return service;
      const flag = service.fields.smart_encoding;
      // A setting that is not plainly true or false is not read as "off": the check reports that it could not tell.
      return typeof flag === "boolean" ? { kind: "read", smartEncoding: flag } : { kind: "unreadable", reason: "setting_missing" };
    },

    /**
     * The two protections against abuse (S07.09). ASSUMED field names, to be confirmed against the production Twilio account at the launch
     * rehearsal (IT; docs/config.md): `sms_pumping_protection` (boolean) and `geo_permissions` (the ISO codes of the countries the service
     * may text). Anything that is not plainly one of those shapes is "could not tell", never "right": a wrong guess shows up as a warning
     * every day, not as a silent pass.
     */
    async readAbuseSettings(messagingServiceSid): Promise<AbuseSettingsReading> {
      const service = await readService(messagingServiceSid);
      if (service.kind === "unreadable") return service;
      const pumping = service.fields.sms_pumping_protection;
      const countries = service.fields.geo_permissions;
      if (typeof pumping !== "boolean") return { kind: "unreadable", reason: "pumping_setting_missing" };
      if (!Array.isArray(countries) || countries.some((code) => typeof code !== "string")) return { kind: "unreadable", reason: "geo_setting_missing" };
      const codes = new Set((countries as string[]).map((code) => code.trim().toUpperCase()));
      return { kind: "read", geoCanadaOnly: codes.size === 1 && codes.has("CA"), pumpingProtection: pumping };
    },
  };
}
