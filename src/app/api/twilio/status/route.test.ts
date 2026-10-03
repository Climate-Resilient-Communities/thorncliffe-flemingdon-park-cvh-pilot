import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db, DbTransaction } from "@/platform/db";

const TOKEN = "fake-auth-token-for-tests";
const BASE = "https://cvh.example";
const REF = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const SID = "SM0123456789abcdef0123456789abcdef";
const NUMBER = "+14165550123";
const SECRET_TEXT = "Power is out in Building 12, a secret resident text";

// The route is about what it answers, what it sets and what it logs. The real use case runs, over an in-memory delivery; the table, the
// lock and the races are in test/db/statusCallbacks.db.test.ts.
const state = vi.hoisted(() => ({
  authToken: undefined as string | undefined,
  delivery: undefined as undefined | { state: string; handedOff: boolean; providerMessageId: string | null; callbackRef: string },
  failTransaction: false,
  events: [] as unknown[],
  applied: 0,
}));

vi.mock("@/app/statusCallback", async () => {
  const { createStatusCallbacks, stdoutMessagingLog } = await import("@/modules/messaging");
  return {
    appStatusCallbacks: () => {
      const tx = {} as DbTransaction;
      return createStatusCallbacks({
        db: {
          transaction: async (run: (t: DbTransaction) => Promise<unknown>) => {
            if (state.failTransaction) throw new Error("connection to 10.0.0.5 refused");
            return run(tx);
          },
        } as unknown as Db,
        store: {
          async lockByCallbackRef(_tx, ref) {
            const d = state.delivery;
            if (!d || d.callbackRef !== ref) return null;
            return { id: "d1", state: d.state, handedOffAt: d.handedOff ? new Date() : null, providerMessageId: d.providerMessageId } as never;
          },
          async applyCallback(_tx, change) {
            state.applied += 1;
            if (state.delivery) Object.assign(state.delivery, { state: change.to, providerMessageId: change.providerMessageId ?? state.delivery.providerMessageId });
            return { id: change.id, state: change.to } as never;
          },
        },
        ops: { record: async (_executor, event) => void state.events.push(event) },
        log: stdoutMessagingLog,
        authToken: state.authToken,
        publicBaseUrl: BASE,
      });
    },
  };
});

const { POST, GET, dynamic } = await import("./route");

const fields = (over: Record<string, string> = {}) => ({ MessageSid: SID, MessageStatus: "delivered", To: NUMBER, From: "+16475550100", Body: SECRET_TEXT, ...over });

/** A request as Twilio makes it, signed for the URL the dispatcher gave it (`ref` null: a URL with no query). */
function request(options: { fields?: Record<string, string>; ref?: string | null; signature?: string | null; host?: string; method?: string; headers?: Record<string, string>; body?: BodyInit } = {}) {
  const form = options.fields ?? fields();
  const ref = options.ref === undefined ? REF : options.ref;
  const path = `/api/twilio/status${ref === null ? "" : `?ref=${ref}`}`;
  const signature = options.signature === undefined ? getExpectedTwilioSignature(TOKEN, `${BASE}${path}`, form) : options.signature;
  return new Request(`${options.host ?? BASE}${path}`, {
    method: options.method ?? "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(signature === null ? {} : { "x-twilio-signature": signature }), ...options.headers },
    body: options.body ?? new URLSearchParams(form).toString(),
  });
}

let logged: string[];
beforeEach(() => {
  state.authToken = TOKEN;
  state.delivery = { state: "claimed", handedOff: true, providerMessageId: null, callbackRef: REF };
  state.failTransaction = false;
  state.events = [];
  state.applied = 0;
  logged = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

const cookies = (response: Response) => response.headers.getSetCookie();

describe("POST /api/twilio/status", () => {
  it("applies a validly signed callback and answers 200", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(state.delivery).toMatchObject({ state: "delivered", providerMessageId: SID });
  });

  it("answers 403 to a request with no signature, a wrong one or one made with another token, and does nothing", async () => {
    for (const make of [() => request({ signature: null }), () => request({ signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" }), () => request({ signature: getExpectedTwilioSignature("another-token", `${BASE}/api/twilio/status?ref=${REF}`, fields()) })]) {
      const response = await POST(make());
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: { code: "invalid_signature" } });
    }
    expect(state.applied).toBe(0);
    expect(state.delivery).toMatchObject({ state: "claimed", providerMessageId: null });
    // Each refusal is counted in ops_event.
    expect(state.events).toHaveLength(3);
    expect(state.events[0]).toMatchObject({ kind: "webhook.signature_invalid", detail: { route: "twilio_status", reason: "missing_signature" } });
  });

  it("refuses a signature made for the same body at another delivery's URL: the reference is signed", async () => {
    const other = "0190ffff-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    const response = await POST(request({ signature: getExpectedTwilioSignature(TOKEN, `${BASE}/api/twilio/status?ref=${other}`, fields()) }));
    expect(response.status).toBe(403);
    expect(state.applied).toBe(0);
  });

  it("builds the URL it validates from PUBLIC_BASE_URL, not from the request's host", async () => {
    // A proxy that rewrites the host does not break a genuine callback...
    expect((await POST(request({ host: "https://some-internal-host.example" }))).status).toBe(200);
    expect(state.applied).toBe(1);
    // ...and a callback signed for another host is refused, whatever host it was sent to.
    state.delivery = { state: "claimed", handedOff: true, providerMessageId: null, callbackRef: REF };
    const form = fields();
    const forged = request({ signature: getExpectedTwilioSignature(TOKEN, `https://evil.example/api/twilio/status?ref=${REF}`, form) });
    expect((await POST(forged)).status).toBe(403);
    expect(state.applied).toBe(1);
  });

  it("answers 200 and changes nothing for a valid callback with no ref, or a ref matching no delivery, and counts it", async () => {
    expect((await POST(request({ ref: null }))).status).toBe(200);
    expect((await POST(request({ ref: "0190ffff-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }))).status).toBe(200);
    expect(state.applied).toBe(0);
    expect(state.delivery!.state).toBe("claimed");
    expect(state.events).toEqual([
      { kind: "delivery.callback_ignored", detail: { reason: "no_ref" } },
      { kind: "delivery.callback_ignored", detail: { reason: "unknown_ref" } },
    ]);
  });

  it("answers 200 to a repeat and does not count it", async () => {
    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(200);
    expect((await POST(request({ fields: fields({ MessageStatus: "sent" }) }))).status).toBe(200);
    expect(state.applied).toBe(1);
    expect(state.events).toEqual([]);
  });

  it("answers 503 and does nothing where there is no Twilio account to validate with, even for a request that looks signed", async () => {
    state.authToken = undefined;
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "webhooks_not_configured" } });
    expect(state.applied).toBe(0);
    expect(state.events).toEqual([]);
  });

  it("answers 500 with no detail when the database fails (the URL the dispatcher gave Twilio asks it to retry a 5xx), and logs only the error's name", async () => {
    state.failTransaction = true;
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "callback_failed" } });
    const text = logged.join("\n");
    expect(text).toContain("callback.failed");
    expect(text).toContain('"error":"Error"');
    expect(text).not.toContain("10.0.0.5");
  });

  it("refuses a body over the limit before reading it all, whether its length is declared or not, and does nothing", async () => {
    const declared = await POST(request({ headers: { "content-length": String(10 * 1024 * 1024) } }));
    expect(declared.status).toBe(413);
    const big = "a=" + "x".repeat(70 * 1024);
    const undeclared = await POST(
      new Request(`${BASE}/api/twilio/status?ref=${REF}`, {
        method: "POST",
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(big.slice(0, 40 * 1024)));
            controller.enqueue(new TextEncoder().encode(big.slice(40 * 1024)));
            controller.close();
          },
        }),
        // @ts-expect-error duplex is required by Node's fetch for a streamed body
        duplex: "half",
      }),
    );
    expect(undeclared.status).toBe(413);
    expect(state.applied).toBe(0);
    expect(state.events).toEqual([]);
  });

  it("answers GET with 405 and the allowed method, and is not cached", async () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is dynamic, so a callback is never answered from a cache", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});

describe("the callback route sets no cookie and never logs the request", () => {
  const scenarios: [string, () => Request, number][] = [
    ["a genuine callback", () => request(), 200],
    ["a repeat", () => request(), 200],
    ["a callback with no ref", () => request({ ref: null }), 200],
    ["a callback for an unknown ref", () => request({ ref: "0190ffff-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }), 200],
    ["a callback with a status it does not know", () => request({ fields: fields({ MessageStatus: "read" }) }), 200],
    ["a request with no signature", () => request({ signature: null }), 403],
    ["a request with a wrong signature", () => request({ signature: "not-the-signature-value" }), 403],
    ["an oversized request", () => request({ headers: { "content-length": "99999999" } }), 413],
  ];

  it.each(scenarios)("%s: no Set-Cookie, never cacheable", async (_name, make, status) => {
    const response = await POST(make());
    expect(response.status).toBe(status);
    expect(cookies(response)).toEqual([]);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does the same when the database fails, when nothing is configured and for a request of another method", async () => {
    state.failTransaction = true;
    const failed = await POST(request());
    state.failTransaction = false;
    state.authToken = undefined;
    const unconfigured = await POST(request());
    for (const response of [failed, unconfigured, GET()]) {
      expect(cookies(response)).toEqual([]);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("logs nothing that is in the request: not the number, the text, the signature, the reference or the message id", async () => {
    const signatures: string[] = [];
    for (const [, make] of scenarios) {
      const req = make();
      const signature = req.headers.get("x-twilio-signature");
      if (signature) signatures.push(signature);
      await POST(req);
    }
    state.failTransaction = true;
    await POST(request());
    expect(logged.length).toBeGreaterThan(0);
    const text = logged.join("\n");
    for (const secret of [NUMBER, "4165550123", "6475550100", "secret resident text", "Building 12", REF, SID, TOKEN, "not-the-signature-value", ...signatures]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});
