import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundMessage, InboundOutcome } from "@/modules/subscriptions";

const TOKEN = "fake-auth-token-for-tests";
const BASE = "https://cvh.example";
const PATH = "/api/twilio/inbound";
const SID = "SM0123456789abcdef0123456789abcdef";
const NUMBER = "+14165550123";
const SECRET_TEXT = "my unit is 1204, please call me";

// The route is about what it answers, what it sets and what it logs: the real webhook (signature check) runs over a fake router. The router
// itself, its tables and its races are in test/db/inbound.db.test.ts.
const state = vi.hoisted(() => ({
  authToken: undefined as string | undefined,
  handled: [] as InboundMessage[],
  outcome: { kind: "handled", keyword: "yes", state: "pending", action: "confirm", replied: true } as InboundOutcome,
  fail: false,
  events: [] as unknown[],
  kicks: 0,
}));

vi.mock("@/app/inbound", async () => {
  const { createInboundWebhook } = await import("@/modules/subscriptions");
  return {
    appInboundWebhook: () =>
      state.authToken
        ? createInboundWebhook({
            authToken: state.authToken,
            publicBaseUrl: BASE,
            router: {
              handle: async (message) => {
                if (state.fail) throw new Error(`connection to 10.0.0.5 refused for ${message.from}`);
                state.handled.push(message);
                return state.outcome;
              },
            },
            recordSignatureFailure: async (reason) => void state.events.push({ kind: "webhook.signature_invalid", detail: { route: "twilio_inbound", reason } }),
          })
        : { handle: async () => ({ kind: "not_configured" }) },
    startSending: () => void (state.kicks += 1),
  };
});

const { POST, GET, dynamic, maxDuration } = await import("./route");

const fields = (over: Record<string, string> = {}) => ({ MessageSid: SID, AccountSid: `AC${"1".repeat(32)}`, From: NUMBER, To: "+16475550100", Body: SECRET_TEXT, ...over });

function request(options: { fields?: Record<string, string>; signature?: string | null; host?: string; headers?: Record<string, string> } = {}) {
  const form = options.fields ?? fields();
  const signature = options.signature === undefined ? getExpectedTwilioSignature(TOKEN, `${BASE}${PATH}`, form) : options.signature;
  return new Request(`${options.host ?? BASE}${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(signature === null ? {} : { "x-twilio-signature": signature }), ...options.headers },
    body: new URLSearchParams(form).toString(),
  });
}

let logged: string[];
beforeEach(() => {
  state.authToken = TOKEN;
  state.handled = [];
  state.outcome = { kind: "handled", keyword: "yes", state: "pending", action: "confirm", replied: true };
  state.fail = false;
  state.events = [];
  state.kicks = 0;
  logged = [];
  for (const method of ["log", "error", "info", "warn"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/twilio/inbound", () => {
  it("hands a validly signed text to the router and answers 200 with an empty TwiML document, so Twilio sends nothing more", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/xml/);
    expect(await response.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(state.handled).toEqual([{ messageSid: SID, from: NUMBER, body: SECRET_TEXT, optOutType: null }]);
    // A reply was queued, so the sender is started.
    expect(state.kicks).toBe(1);
  });

  it("passes Twilio's OptOutType on, and starts no sender when nothing was queued", async () => {
    state.outcome = { kind: "handled", keyword: "stop", state: "active", action: "delete", replied: false };
    const response = await POST(request({ fields: fields({ Body: "STOP", OptOutType: "STOP" }) }));
    expect(response.status).toBe(200);
    expect(state.handled[0]).toMatchObject({ body: "STOP", optOutType: "STOP" });
    expect(state.kicks).toBe(0);
  });

  it("answers a retry (a MessageSid already seen) with the same 200 and starts nothing", async () => {
    state.outcome = { kind: "duplicate" };
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<Response></Response>");
    expect(state.kicks).toBe(0);
  });

  it("answers 403 to no signature, a wrong one, one made with another token or for another host, and does nothing but count it", async () => {
    const form = fields();
    for (const make of [
      () => request({ signature: null }),
      () => request({ signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" }),
      () => request({ signature: getExpectedTwilioSignature("another-token", `${BASE}${PATH}`, form) }),
      () => request({ signature: getExpectedTwilioSignature(TOKEN, `https://evil.example${PATH}`, form) }),
      () => request({ signature: getExpectedTwilioSignature(TOKEN, `${BASE}/api/twilio/status`, form) }),
    ]) {
      const response = await POST(make());
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: { code: "invalid_signature" } });
    }
    expect(state.handled).toEqual([]);
    expect(state.events).toHaveLength(5);
    expect(state.events[0]).toEqual({ kind: "webhook.signature_invalid", detail: { route: "twilio_inbound", reason: "missing_signature" } });
    expect(state.events[1]).toEqual({ kind: "webhook.signature_invalid", detail: { route: "twilio_inbound", reason: "signature_mismatch" } });
  });

  it("validates against PUBLIC_BASE_URL, not the request's host", async () => {
    expect((await POST(request({ host: "https://some-internal-host.example" }))).status).toBe(200);
    expect(state.handled).toHaveLength(1);
  });

  it("answers 200 and does nothing for a signed request with no usable MessageSid or From", async () => {
    for (const over of [{ MessageSid: "not-a-sid" }, { From: "" }] as Record<string, string>[]) {
      const form = fields(over);
      expect((await POST(request({ fields: form }))).status).toBe(200);
    }
    expect(state.handled).toEqual([]);
  });

  it("answers 503 and does nothing where there is no Twilio account", async () => {
    state.authToken = undefined;
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(state.handled).toEqual([]);
    expect(state.events).toEqual([]);
  });

  it("answers 500 with no detail when the router fails, and logs only the error's name: never the number or the text", async () => {
    state.fail = true;
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "inbound_failed" } });
    const text = logged.join("\n");
    expect(text).toContain("inbound.failed");
    expect(text).not.toContain("5550123");
    expect(text).not.toContain("10.0.0.5");
    expect(text).not.toContain(SECRET_TEXT);
  });

  it("logs nothing of a handled request", async () => {
    await POST(request());
    await POST(request({ signature: null }));
    const text = logged.join("\n");
    expect(text).not.toContain("5550123");
    expect(text).not.toContain(SECRET_TEXT);
  });

  it("refuses a body over the limit with 413 and does nothing", async () => {
    const response = await POST(request({ headers: { "content-length": String(10 * 1024 * 1024) } }));
    expect(response.status).toBe(413);
    expect(state.handled).toEqual([]);
  });

  it("answers GET with 405, and is dynamic", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(60);
  });
});
