// The Twilio adapter of the SmsProvider port (S01.15): one POST to Twilio's Messages REST resource
// with `fetch`, no SDK. It sends once and never retries (a retry could send a second text); whatever
// Twilio answers is returned as data (an error's message with any phone number in it hidden). Credentials are used only in the Authorization header: they
// are never put in a URL, a log line or an error.
import type { OutboundText, ProviderAnswer, SmsProvider } from "../application/ports";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** Twilio's API origin; a test seam (default https://api.twilio.com). */
  baseUrl?: string;
  /** A test seam (default the global fetch). */
  fetch?: typeof fetch;
  /** How long to wait for Twilio before giving up as "no answer" (default 15 seconds). */
  timeoutMs?: number;
}

const MESSAGE_SID = /^(SM|MM)[0-9a-f]{32}$/;
const STATUS_WORD = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_MESSAGE_LENGTH = 300;
// Twilio's error messages can quote the number ("The 'To' number +14165550101 is not a valid phone number."): any run
// that looks like a phone number is hidden before the message goes anywhere near the screen.
const PHONE_NUMBER_LIKE = /\+?\d[\d\s().-]{6,}\d/g;
export const maskPhoneNumbers = (text: string) => text.replace(PHONE_NUMBER_LIKE, "[number]");

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function jsonOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function twilioSmsProvider(config: TwilioConfig): SmsProvider {
  const { accountSid, authToken } = config;
  const base = (config.baseUrl ?? "https://api.twilio.com").replace(/\/+$/, "");
  const doFetch = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;

  return {
    async send(text: OutboundText): Promise<ProviderAnswer> {
      let response: Response;
      try {
        response = await doFetch(`${base}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({ To: text.to, From: text.from, Body: text.body }).toString(),
          // Never follow a redirect with the credentials.
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { kind: "unreachable" };
      }

      const body = await jsonOf(response);
      if (response.ok) {
        const sid = isRecord(body) ? body.sid : undefined;
        const status = isRecord(body) && typeof body.status === "string" ? body.status.toLowerCase().replace(/[^a-z0-9_]/g, "_") : "";
        // A 2xx without a message id is not a text we can account for: treat it as no usable answer.
        if (typeof sid !== "string" || !MESSAGE_SID.test(sid)) return { kind: "unreachable" };
        return { kind: "accepted", httpStatus: response.status, status: STATUS_WORD.test(status) ? status : "unknown", messageId: sid };
      }

      const code = isRecord(body) && typeof body.code === "number" && Number.isInteger(body.code) && body.code >= 0 && body.code <= 999_999 ? body.code : null;
      const message = isRecord(body) && typeof body.message === "string" && body.message.trim() !== "" ? maskPhoneNumbers(body.message.trim()).slice(0, MAX_MESSAGE_LENGTH) : null;
      return { kind: "rejected", httpStatus: Math.min(Math.max(response.status, 100), 599), errorCode: code, message };
    },
  };
}
