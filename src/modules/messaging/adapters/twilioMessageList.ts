// The Twilio adapter of the reconciliation (S06.08): the Messages resource listed, one page at a time, with `fetch` and no SDK. It is BUILT
// here and called only by the job that wires it in production (src/app/reconcile.ts, `SMS_MODE=live` with Twilio's credentials); no
// test and no other environment ever calls it, so it is tested against a fake `fetch` only.
//
// It reads, never writes: a GET of `/2010-04-01/Accounts/{AccountSid}/Messages.json` for the messages sent between two instants, then the
// `next_page_uri` of each page as the page gives it, until the page gives none. It asks for the largest page (1,000), and asks for a little
// more than the interval on each side (one second), because it cannot tell from the documentation whether the date filters include their
// bound; the reconciliation keeps only the messages sent in its exact interval, so what the filter does at the edges changes nothing.
// A `next_page_uri` is followed only if it is the account's own Messages path: the credentials travel in the Authorization header of every
// request, so a URI that named another host or path (an absolute URL, a `//host` path) is refused instead of being followed.
// Anything unexpected (a refusal, a redirect, a body that is not a page, a field of the wrong type) throws `MessageListError`, which the
// reconciliation turns into a pending reconciliation with nothing recorded. No error carries the body: a listing never reads a number or
// a text, and the error holds only a code.
import type { MessagePage, ProviderMessage, SmsMessageLister } from "../../spend";

export interface TwilioListConfig {
  accountSid: string;
  authToken: string;
  /** Twilio's API origin; a test seam (default https://api.twilio.com). */
  baseUrl?: string;
  /** A test seam (default the global fetch). */
  fetch?: typeof fetch;
  /** How long to wait for a page (default 15 seconds). */
  timeoutMs?: number;
  /** Messages per page (default 1,000, Twilio's largest). */
  pageSize?: number;
}

/** The listing could not be read; `code` says why and never quotes the provider's answer. */
export class MessageListError extends Error {
  override name = "MessageListError";
  constructor(readonly code: "http_status" | "unreadable" | "not_a_page" | "next_page_refused" | "request_failed") {
    super(code);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The widening of the requested range on each side, in milliseconds. */
const WIDEN_MS = 1000;

export function twilioMessageLister(config: TwilioListConfig): SmsMessageLister {
  const base = (config.baseUrl ?? "https://api.twilio.com").replace(/\/+$/, "");
  const doFetch = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const pageSize = Math.min(Math.max(Math.trunc(config.pageSize ?? 1000), 1), 1000);
  const messagesPath = `/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  const authorization = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`;

  async function read(url: string): Promise<MessagePage> {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: "GET",
        headers: { Authorization: authorization, Accept: "application/json" },
        // Never follow a redirect with the credentials.
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new MessageListError("request_failed");
    }
    if (!response.ok) throw new MessageListError("http_status");
    let body: unknown;
    try {
      body = JSON.parse(await response.text());
    } catch {
      throw new MessageListError("unreadable");
    }
    if (!isRecord(body) || !Array.isArray(body.messages)) throw new MessageListError("not_a_page");
    // The page must say whether there is a next one: a missing `next_page_uri` is a page that may have been cut off, not the last page.
    if (!("next_page_uri" in body) || (body.next_page_uri !== null && typeof body.next_page_uri !== "string")) throw new MessageListError("not_a_page");

    const messages: ProviderMessage[] = body.messages.map((item): ProviderMessage => {
      if (!isRecord(item)) throw new MessageListError("not_a_page");
      const sent = text(item.date_sent);
      const parsed = sent === null ? null : new Date(sent);
      return {
        sid: text(item.sid) ?? "",
        direction: text(item.direction) ?? "",
        dateSent: parsed === null || Number.isNaN(parsed.getTime()) ? null : parsed,
        price: text(item.price),
        priceUnit: text(item.price_unit),
      };
    });
    return { messages, nextPageUri: body.next_page_uri === "" ? null : (body.next_page_uri as string | null) };
  }

  return {
    first({ startUtc, endUtc }) {
      const query = new URLSearchParams({
        PageSize: String(pageSize),
        "DateSent>": new Date(startUtc.getTime() - WIDEN_MS).toISOString(),
        "DateSent<": new Date(endUtc.getTime() + WIDEN_MS).toISOString(),
      });
      return read(`${base}${messagesPath}?${query.toString()}`);
    },

    next(nextPageUri) {
      // Only this account's own Messages resource, as a path: no other host, and no other resource, is ever sent the credentials.
      if (!nextPageUri.startsWith("/") || nextPageUri.startsWith("//") || !(nextPageUri === messagesPath || nextPageUri.startsWith(`${messagesPath}?`))) {
        return Promise.reject(new MessageListError("next_page_refused"));
      }
      return read(`${base}${nextPageUri}`);
    },
  };
}
