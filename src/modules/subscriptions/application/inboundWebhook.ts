// `POST /api/twilio/inbound` (S07.04): the signature first, then the router (E07 "Inbound order", step 1). Twilio cannot sign in, so
// everything rests on `X-Twilio-Signature`, checked as the status callbacks check theirs (S06.04: messaging's `isValidTwilioSignature`)
// against PUBLIC_BASE_URL + the inbound path, as the Messaging Service was configured with it, and the form body. A wrong or missing
// signature is refused before any other work and recorded as `webhook.signature_invalid` with the route `twilio_inbound` (the composition
// root records it in ops_event; the health job counts both routes toward one alert). With no Twilio account configured (every environment
// but production) nothing can be validated and nothing is done. Nothing of the request is logged: not its number, its text or its signature.
import { isValidTwilioSignature } from "../../messaging";
import { INBOUND_PATH, isMessageSid } from "../domain/inbound";
import type { InboundOutcome, InboundRouter } from "./inbound";

/** The request as the route gives it, before anything of it is believed. */
export interface InboundRequest {
  /** The `X-Twilio-Signature` header; null when there is none. */
  signature: string | null;
  /** The request URL's query string as received, or "" for none. */
  search: string;
  /** The raw form body (`application/x-www-form-urlencoded`). */
  body: string;
}

export type SignatureRefusal = "missing_signature" | "signature_mismatch";

export type InboundResult =
  | { kind: "not_configured" }
  | { kind: "rejected"; reason: SignatureRefusal }
  /** Signed, but with no usable MessageSid or From: nothing is done. */
  | { kind: "ignored" }
  | InboundOutcome;

export interface InboundWebhookDeps {
  /** The Twilio account's Auth Token; undefined where there is no Twilio account. */
  authToken: string | undefined;
  /** PUBLIC_BASE_URL: an https origin with no path. */
  publicBaseUrl: string;
  router: InboundRouter;
  /** Records a refused signature (ops_event `webhook.signature_invalid`, route `twilio_inbound`); a failure to record never changes the 403. */
  recordSignatureFailure: (reason: SignatureRefusal) => Promise<void>;
}

export interface InboundWebhook {
  handle(request: InboundRequest): Promise<InboundResult>;
}

/** The longest body the router reads: Twilio's limit for a text is 1600 characters. */
const MAX_TEXT_CHARS = 1600;

export function createInboundWebhook(deps: InboundWebhookDeps): InboundWebhook {
  const signedUrl = (search: string) =>
    `${deps.publicBaseUrl.replace(/\/+$/, "")}${INBOUND_PATH}${search === "" || search === "?" ? "" : search.startsWith("?") ? search : `?${search}`}`;

  return {
    async handle(request) {
      if (!deps.authToken) return { kind: "not_configured" };
      const params = new URLSearchParams(request.body);
      if (!isValidTwilioSignature(deps.authToken, request.signature, signedUrl(request.search), [...params.entries()])) {
        const reason: SignatureRefusal = request.signature === null || request.signature === "" ? "missing_signature" : "signature_mismatch";
        await deps.recordSignatureFailure(reason).catch(() => undefined);
        return { kind: "rejected", reason };
      }
      const messageSid = params.get("MessageSid") ?? params.get("SmsMessageSid");
      const from = params.get("From");
      if (!isMessageSid(messageSid) || from === null || from === "") return { kind: "ignored" };
      return deps.router.handle({
        messageSid,
        from,
        body: (params.get("Body") ?? "").slice(0, MAX_TEXT_CHARS),
        optOutType: params.get("OptOutType"),
      });
    },
  };
}
