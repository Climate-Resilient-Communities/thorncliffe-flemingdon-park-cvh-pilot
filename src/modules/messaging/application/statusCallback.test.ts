// The status callback use case with an in-memory store and no database: the order of what it does (the signature first, then the
// reference, then the payload, then the row), what it records, and what it never does (touch a row for a callback that is not
// signed, or log a number or a text). The real table, the row lock and the races with the dispatcher are in
// test/db/statusCallbacks.db.test.ts.
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import { describe, expect, it } from "vitest";
import type { Db, DbTransaction } from "../../../platform/db";
import { providerStatusCallbackUrl, statusCallbackUrl } from "../domain/dispatchRules";
import { TERMINAL_STATES } from "../domain/deliveryState";
import type { DeliveryView, MessagingLog } from "./deliveryPorts";
import type { MessagingOpsEvent } from "./dispatcherPorts";
import { createStatusCallbacks, type CallbackRequest, type CallbackStore } from "./statusCallback";

const TOKEN = "fake-auth-token-for-tests";
const BASE = "https://cvh.example";
const REF = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const SID = "SM0123456789abcdef0123456789abcdef";
const OTHER_SID = "SMffffffffffffffffffffffffffffffff";
const DELIVERY = "01900000-0000-7000-8000-0000000d0001";
const NUMBER = "+14165550123";
const SECRET_TEXT = "Power is out in Building 12, a secret resident text";

function row(over: Partial<DeliveryView> = {}): DeliveryView {
  return {
    id: DELIVERY,
    kind: "transactional",
    recipientKind: "subscriber",
    recipientId: "01900000-0000-7000-8000-0000000a0001",
    entryId: null,
    campaignId: null,
    createdByModule: "subscriptions",
    purpose: "menu_reply",
    lang: "en",
    body: "Reply 1 to change your building.",
    segments: 1,
    costEstimateCents: 2,
    idempotencyKey: "transactional:s:menu_reply:n",
    callbackRef: REF,
    state: "claimed",
    attempts: 0,
    dueAt: new Date(),
    sendBy: null,
    claimedAt: new Date(),
    claimedBy: "dispatch-1",
    claimToken: "01900000-0000-7000-8000-00000000f001",
    handedOffAt: new Date(),
    submittedAt: null,
    providerMessageId: null,
    providerErrorCode: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

/** A body as Twilio sends it, with the personal parts a log line must never repeat. */
const callbackForm = (fields: Record<string, string> = {}) => ({ MessageSid: SID, MessageStatus: "delivered", To: NUMBER, From: "+16475550100", Body: SECRET_TEXT, AccountSid: `AC${"0".repeat(32)}`, ...fields });

/** The request Twilio would make, signed by the official library's helper for the URL the dispatcher gave it. */
function signed(fields: Record<string, string> = callbackForm(), ref: string | null = REF, token = TOKEN): CallbackRequest {
  const url = ref === null ? `${BASE}/api/twilio/status` : statusCallbackUrl(BASE, ref);
  return { signature: getExpectedTwilioSignature(token, url, fields), search: new URL(url).search, body: new URLSearchParams(fields).toString() };
}

function world(
  initial: DeliveryView | null = row(),
  options: {
    authToken?: string | undefined;
    failOps?: (event: MessagingOpsEvent) => boolean;
    afterOutcome?: (view: DeliveryView) => Promise<void>;
    afterProviderId?: (view: DeliveryView) => Promise<void>;
  } = {},
) {
  let current = initial;
  const events: MessagingOpsEvent[] = [];
  const lines: { level: string; evt: string; fields: Record<string, unknown> }[] = [];
  const calls: string[] = [];
  let transactions = 0;
  const tx: DbTransaction = { transaction: async <T>(run: (inner: DbTransaction) => Promise<T>) => run(tx) } as unknown as DbTransaction;
  const db = {
    transaction: async <T>(run: (transaction: DbTransaction) => Promise<T>) => {
      transactions += 1;
      // A transaction that throws is rolled back: the row is as it was.
      const before = current ? { ...current } : current;
      const eventsBefore = events.length;
      try {
        return await run(tx);
      } catch (error) {
        current = before;
        events.length = eventsBefore;
        throw error;
      }
    },
  } as unknown as Db;
  const store: CallbackStore = {
    async lockByCallbackRef(_tx, ref) {
      calls.push(`lock:${ref}`);
      return current && current.callbackRef === ref ? { ...current } : null;
    },
    async applyCallback(_tx, change) {
      calls.push(`apply:${change.from}>${change.to}`);
      if (!current || current.id !== change.id || current.state !== change.from) return null;
      current = {
        ...current,
        state: change.to,
        providerMessageId: change.providerMessageId ?? current.providerMessageId,
        providerErrorCode: change.errorCode ?? current.providerErrorCode,
      };
      return { ...current };
    },
  };
  const log: MessagingLog = { info: (evt, fields) => void lines.push({ level: "info", evt, fields }), error: (evt, fields) => void lines.push({ level: "error", evt, fields }) };
  const hooked: string[] = [];
  const service = createStatusCallbacks({
    db,
    store,
    ops: {
      record: async (_executor, event) => {
        if (options.failOps?.(event)) throw new Error("the ops event could not be written");
        events.push(event);
      },
    },
    log,
    authToken: "authToken" in options ? options.authToken : TOKEN,
    publicBaseUrl: BASE,
    afterOutcome: options.afterOutcome
      ? async (_tx, view) => {
          hooked.push(`outcome:${view.state}`);
          await options.afterOutcome?.(view);
        }
      : undefined,
    afterProviderId: options.afterProviderId
      ? async (_tx, view) => {
          hooked.push(`provider_id:${view.providerMessageId}`);
          await options.afterProviderId?.(view);
        }
      : undefined,
  });
  return { service, events, lines, calls, hooked, row: () => current, transactions: () => transactions };
}

describe("a callback with nothing to check it with", () => {
  it("is not believed: with no Twilio account's token nothing is validated, read or written", async () => {
    const w = world(row(), { authToken: undefined });
    await expect(w.service.handle(signed())).resolves.toEqual({ kind: "not_configured" });
    expect(w.calls).toEqual([]);
    expect(w.events).toEqual([]);
    expect(w.transactions()).toBe(0);
  });

  it("is not believed either with an empty token", async () => {
    const w = world(row(), { authToken: "" });
    await expect(w.service.handle(signed())).resolves.toEqual({ kind: "not_configured" });
    expect(w.calls).toEqual([]);
  });
});

describe("the signature, before any work", () => {
  it("refuses a request with no signature header: counted, nothing read or changed", async () => {
    const w = world();
    const request = { ...signed(), signature: null };
    await expect(w.service.handle(request)).resolves.toEqual({ kind: "rejected", reason: "missing_signature" });
    expect(w.events).toEqual([{ kind: "webhook.signature_invalid", detail: { route: "twilio_status", reason: "missing_signature" } }]);
    expect(w.calls).toEqual([]);
    expect(w.transactions()).toBe(0);
    expect(w.row()).toMatchObject({ state: "claimed", providerMessageId: null });
  });

  it("refuses an empty, wrong, altered or other-token signature: counted, nothing read or changed", async () => {
    for (const make of [
      (r: CallbackRequest) => ({ ...r, signature: "" }),
      (r: CallbackRequest) => ({ ...r, signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" }),
      (r: CallbackRequest) => ({ ...r, signature: `${(r.signature as string).slice(0, -2)}A=` }),
      () => signed(callbackForm(), REF, "another-token"),
      // The body was changed after it was signed.
      (r: CallbackRequest) => ({ ...r, body: r.body.replace("delivered", "failed") }),
      // The same body and signature for another delivery's reference: the reference is part of what is signed.
      (r: CallbackRequest) => ({ ...r, search: "?ref=0190ffff-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }),
      // The same, with an extra parameter in the URL.
      (r: CallbackRequest) => ({ ...r, search: `${r.search}&x=1` }),
    ]) {
      const w = world();
      const result = await w.service.handle(make(signed()));
      expect(result.kind).toBe("rejected");
      expect(w.events).toHaveLength(1);
      expect(w.events[0]).toMatchObject({ kind: "webhook.signature_invalid", detail: { route: "twilio_status" } });
      expect(w.calls).toEqual([]);
      expect(w.row()!.state).toBe("claimed");
    }
  });

  it("refuses a body signed for another URL: the host is the app's own base URL, never the request's", async () => {
    const w = world();
    const fields = callbackForm();
    const url = `https://evil.example/api/twilio/status?ref=${REF}`;
    const result = await w.service.handle({ signature: getExpectedTwilioSignature(TOKEN, url, fields), search: `?ref=${REF}`, body: new URLSearchParams(fields).toString() });
    expect(result.kind).toBe("rejected");
    expect(w.calls).toEqual([]);
  });

  it("answers refused even when the event cannot be written (a database that is down still says 403), and says so in the log", async () => {
    const w = world(row(), { failOps: () => true });
    await expect(w.service.handle({ ...signed(), signature: "nope" })).resolves.toEqual({ kind: "rejected", reason: "signature_mismatch" });
    expect(w.lines.find((line) => line.evt === "callback.ops_event_failed")?.fields).toEqual({ evt_kind: "webhook.signature_invalid", error: "Error" });
  });

  it("accepts the callback Twilio makes to the URL the provider was given with its connection overrides: the fragment is not sent and not signed, so the signed URL is the one without it", async () => {
    const w = world();
    const given = providerStatusCallbackUrl(BASE, REF);
    expect(given).toContain("#rc=3");
    const fields = callbackForm();
    const called = given.split("#")[0];
    // What reaches the route: the URL without its fragment, signed by Twilio (the official helper) for that URL.
    const request = { signature: getExpectedTwilioSignature(TOKEN, called, fields), search: new URL(given).search, body: new URLSearchParams(fields).toString() };
    expect(request.search).toBe(`?ref=${REF}`);
    await expect(w.service.handle(request)).resolves.toMatchObject({ kind: "applied", to: "delivered" });
    // A signature made over the URL including the fragment is not what Twilio sends, and is refused.
    const w2 = world();
    await expect(w2.service.handle({ ...request, signature: getExpectedTwilioSignature(TOKEN, given, fields) })).resolves.toMatchObject({ kind: "rejected" });
    expect(w2.calls).toEqual([]);
  });

  it("accepts the signature the official library computes for the URL the dispatcher gives Twilio, and tolerates a base URL with a trailing slash", async () => {
    const w = world();
    await expect(w.service.handle(signed())).resolves.toMatchObject({ kind: "applied", to: "delivered" });
    const slashed = createStatusCallbacks({ db: { transaction: async (run: (t: DbTransaction) => unknown) => run({} as DbTransaction) } as unknown as Db, store: { lockByCallbackRef: async () => null, applyCallback: async () => null }, ops: { record: async () => undefined }, log: { info: () => undefined, error: () => undefined }, authToken: TOKEN, publicBaseUrl: `${BASE}/` });
    await expect(slashed.handle(signed())).resolves.toEqual({ kind: "ignored", reason: "unknown_ref" });
  });
});

describe("a signed callback that is about nothing", () => {
  it("with no ref: changes nothing and is counted, with no delivery named", async () => {
    const w = world();
    await expect(w.service.handle(signed(callbackForm(), null))).resolves.toEqual({ kind: "ignored", reason: "no_ref" });
    expect(w.events).toEqual([{ kind: "delivery.callback_ignored", detail: { reason: "no_ref" } }]);
    expect(w.calls).toEqual([]);
    expect(w.row()!.state).toBe("claimed");
  });

  it("with a ref that matches no delivery: changes nothing and is counted", async () => {
    const w = world();
    const other = "0190ffff-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    await expect(w.service.handle(signed(callbackForm(), other))).resolves.toEqual({ kind: "ignored", reason: "unknown_ref" });
    expect(w.events).toEqual([{ kind: "delivery.callback_ignored", detail: { reason: "unknown_ref" } }]);
    expect(w.calls).toEqual([`lock:${other}`]);
    expect(w.row()!.state).toBe("claimed");
  });

  it("with a ref that cannot be a delivery's: counted as unknown, and the database is not asked", async () => {
    const w = world();
    const url = `${BASE}/api/twilio/status?ref=1%27%3B--`;
    const fields = callbackForm();
    const result = await w.service.handle({ signature: getExpectedTwilioSignature(TOKEN, url, fields), search: new URL(url).search, body: new URLSearchParams(fields).toString() });
    expect(result).toEqual({ kind: "ignored", reason: "unknown_ref" });
    expect(w.calls).toEqual([]);
    expect(w.events).toEqual([{ kind: "delivery.callback_ignored", detail: { reason: "unknown_ref" } }]);
  });

  it.each<[string, Record<string, string>]>([
    ["no MessageSid", { MessageSid: "" }],
    ["a status it does not know", { MessageStatus: "read" }],
    ["a MessageSid of the wrong shape", { MessageSid: "SM1" }],
  ])("with %s: changes nothing and is counted as an invalid payload, the delivery not being read", async (_name, over) => {
    const w = world();
    const fields: Record<string, string> = callbackForm(over);
    if (over.MessageSid === "") delete fields.MessageSid;
    await expect(w.service.handle(signed(fields))).resolves.toEqual({ kind: "ignored", reason: "invalid_payload" });
    expect(w.events).toEqual([{ kind: "delivery.callback_ignored", detail: { reason: "invalid_payload" } }]);
    expect(w.calls).toEqual([]);
    expect(w.row()!.state).toBe("claimed");
  });

  it("counts a callback for a delivery that was never handed to the provider (a surprise, not a repeat), naming the delivery", async () => {
    for (const initial of [row({ state: "queued", handedOffAt: null, claimedAt: null, claimedBy: null, claimToken: null }), row({ handedOffAt: null }), row({ state: "failed", completedAt: new Date() })]) {
      const w = world(initial);
      await expect(w.service.handle(signed())).resolves.toEqual({ kind: "ignored", reason: "not_in_flight" });
      expect(w.events).toEqual([{ kind: "delivery.callback_ignored", deliveryId: DELIVERY, detail: { reason: "not_in_flight" } }]);
      expect(w.row()!.state).toBe(initial.state);
    }
  });
});

describe("a signed callback for a delivery", () => {
  it("moves a claimed row that was handed off to the callback's status and stores the message id it lacks", async () => {
    const w = world();
    await expect(w.service.handle(signed(callbackForm({ MessageStatus: "undelivered", ErrorCode: "30003" })))).resolves.toEqual({ kind: "applied", from: "claimed", to: "undelivered" });
    expect(w.row()).toMatchObject({ state: "undelivered", providerMessageId: SID, providerErrorCode: 30003 });
    expect(w.events).toEqual([]);
    expect(w.transactions()).toBe(1);
  });

  it("resolves an unknown row: it moves to the callback's status and ops_event says the unknown is resolved, in the same transaction", async () => {
    for (const [status, to] of [["delivered", "delivered"], ["sent", "submitted"], ["undelivered", "undelivered"], ["failed", "failed"]] as const) {
      const w = world(row({ state: "unknown", providerMessageId: null }));
      await expect(w.service.handle(signed(callbackForm({ MessageStatus: status })))).resolves.toEqual({ kind: "applied", from: "unknown", to });
      expect(w.row()).toMatchObject({ state: to, providerMessageId: SID });
      expect(w.events).toEqual([{ kind: "delivery.unknown_resolved", deliveryId: DELIVERY, detail: { status: to } }]);
    }
  });

  it("leaves an unknown row that aged out of submitted exactly as it is for a non-terminal status, however often it comes, and resolves it on a final one", async () => {
    const agedOut = row({ state: "unknown", providerMessageId: SID, submittedAt: new Date(Date.now() - 25 * 60 * 60_000) });
    const w = world(agedOut);
    for (const status of ["sent", "queued", "sending", "accepted", "scheduled", "sent"]) {
      await expect(w.service.handle(signed(callbackForm({ MessageStatus: status }))), status).resolves.toEqual({ kind: "ignored", reason: "no_change" });
    }
    // Nothing was written or counted: the row was only read under its lock.
    expect(w.row()).toEqual(agedOut);
    expect(w.events).toEqual([]);
    expect(w.calls.filter((call) => call.startsWith("apply:"))).toEqual([]);
    // A final status still resolves it, once.
    await expect(w.service.handle(signed(callbackForm({ MessageStatus: "delivered" })))).resolves.toEqual({ kind: "applied", from: "unknown", to: "delivered" });
    expect(w.row()).toMatchObject({ state: "delivered", providerMessageId: SID });
    expect(w.events).toEqual([{ kind: "delivery.unknown_resolved", deliveryId: DELIVERY, detail: { status: "delivered" } }]);
  });

  it("rolls the change back with its event if the event cannot be written, so a resolved unknown is never unrecorded", async () => {
    const w = world(row({ state: "unknown" }), { failOps: (event) => event.kind === "delivery.unknown_resolved" });
    await expect(w.service.handle(signed())).rejects.toThrow("could not be written");
    expect(w.row()).toMatchObject({ state: "unknown", providerMessageId: null });
    expect(w.events).toEqual([]);
  });

  it("changes nothing and records the mismatch when the row already has a different provider id, whatever the status", async () => {
    for (const state of ["submitted", "unknown", "delivered"] as const) {
      const w = world(row({ state, providerMessageId: OTHER_SID }));
      await expect(w.service.handle(signed())).resolves.toEqual({ kind: "mismatch" });
      expect(w.row()).toMatchObject({ state, providerMessageId: OTHER_SID });
      expect(w.events).toEqual([{ kind: "delivery.provider_id_mismatch", deliveryId: DELIVERY, detail: {} }]);
      expect(w.lines.some((line) => line.evt === "callback.provider_id_mismatch")).toBe(true);
    }
  });

  it("changes nothing, and counts nothing, for a repeat, an out-of-order status or a status after a terminal one", async () => {
    // delivered, then the same again, then a non-terminal status that arrives late.
    const w = world(row({ state: "claimed" }));
    await w.service.handle(signed(callbackForm({ MessageStatus: "delivered" })));
    const delivered = w.row();
    for (const status of ["delivered", "sent", "queued", "sending", "failed", "undelivered"]) {
      await expect(w.service.handle(signed(callbackForm({ MessageStatus: status }))), status).resolves.toEqual({ kind: "ignored", reason: "final" });
    }
    expect(w.row()).toEqual(delivered);
    expect(w.events).toEqual([]);
    // A repeat of a non-terminal status on a submitted row.
    const s = world(row({ state: "submitted", providerMessageId: SID }));
    await expect(s.service.handle(signed(callbackForm({ MessageStatus: "sent" })))).resolves.toEqual({ kind: "ignored", reason: "no_change" });
    expect(s.events).toEqual([]);
    expect(s.row()!.state).toBe("submitted");
    for (const state of TERMINAL_STATES) {
      const t = world(row({ state, providerMessageId: SID }));
      await expect(t.service.handle(signed())).resolves.toMatchObject({ kind: "ignored" });
      expect(t.row()!.state).toBe(state);
    }
  });
});

describe("the spend seam", () => {
  it("is called once, with the updated row, for the callback that moves a claimed row (the dispatcher never records that outcome)", async () => {
    const w = world(row(), { afterOutcome: async () => undefined });
    await w.service.handle(signed());
    expect(w.hooked).toEqual(["outcome:delivered"]);
  });

  it("tells S06.08 a provider id was recorded later: once, with the updated row, for a claimed row and for an unknown one that had no id, before the outcome hook", async () => {
    const claimed = world(row(), { afterOutcome: async () => undefined, afterProviderId: async () => undefined });
    await claimed.service.handle(signed());
    expect(claimed.hooked).toEqual([`provider_id:${SID}`, "outcome:delivered"]);
    const unknown = world(row({ state: "unknown" }), { afterOutcome: async () => undefined, afterProviderId: async () => undefined });
    await unknown.service.handle(signed());
    // An unknown row's estimate was counted when it became unknown: only the id is new.
    expect(unknown.hooked).toEqual([`provider_id:${SID}`]);
  });

  it("does not tell it when the delivery already had the id, or when nothing changed", async () => {
    for (const initial of [row({ state: "submitted", providerMessageId: SID }), row({ state: "unknown", providerMessageId: SID }), row({ state: "delivered", providerMessageId: SID }), row({ state: "submitted", providerMessageId: OTHER_SID }), row({ state: "queued", handedOffAt: null })]) {
      const w = world(initial, { afterOutcome: async () => undefined, afterProviderId: async () => undefined });
      await w.service.handle(signed());
      expect(w.hooked, initial.state).toEqual([]);
    }
  });

  it("never undoes the status when the provider-id hook fails either, and the outcome hook still runs", async () => {
    const w = world(row(), {
      afterProviderId: async () => {
        throw new TypeError("could not match the actual for +14165550123");
      },
      afterOutcome: async () => undefined,
    });
    await expect(w.service.handle(signed())).resolves.toMatchObject({ kind: "applied", to: "delivered" });
    expect(w.row()).toMatchObject({ state: "delivered", providerMessageId: SID });
    expect(w.hooked).toEqual([`provider_id:${SID}`, "outcome:delivered"]);
    expect(w.lines.find((line) => line.evt === "callback.spend_hook_failed")?.fields).toEqual({ hook: "provider_id", delivery_id: DELIVERY, error: "TypeError" });
  });

  it("is not called when the callback only resolves an unknown, moves a submitted row, or changes nothing", async () => {
    const hooked = { n: 0 };
    for (const initial of [row({ state: "unknown" }), row({ state: "submitted", providerMessageId: SID }), row({ state: "delivered", providerMessageId: SID }), row({ state: "claimed", providerMessageId: OTHER_SID })]) {
      const w = world(initial, { afterOutcome: async () => void (hooked.n += 1) });
      await w.service.handle(signed());
    }
    expect(hooked.n).toBe(0);
  });

  it("never undoes the status when it fails: the delivery status is kept and the failure is logged by name", async () => {
    const w = world(row(), {
      afterOutcome: async () => {
        throw new TypeError("spend_event insert failed for +14165550123");
      },
    });
    await expect(w.service.handle(signed())).resolves.toMatchObject({ kind: "applied", to: "delivered" });
    expect(w.row()).toMatchObject({ state: "delivered", providerMessageId: SID });
    expect(w.lines.find((line) => line.evt === "callback.spend_hook_failed")?.fields).toEqual({ hook: "outcome", delivery_id: DELIVERY, error: "TypeError" });
  });
});

describe("what is logged", () => {
  it("never holds the number, the text, the signature, the reference or the provider id, whatever the callback came to", async () => {
    const requests: [string, ReturnType<typeof world>, CallbackRequest][] = [
      ["applied", world(), signed()],
      ["unknown resolved", world(row({ state: "unknown" })), signed()],
      ["mismatch", world(row({ state: "submitted", providerMessageId: OTHER_SID })), signed()],
      ["repeat", world(row({ state: "delivered", providerMessageId: SID })), signed()],
      ["not in flight", world(row({ state: "queued", handedOffAt: null })), signed()],
      ["no ref", world(), signed(callbackForm(), null)],
      ["unknown ref", world(null), signed()],
      ["bad payload", world(), signed(callbackForm({ MessageStatus: "read" }))],
      ["bad signature", world(), { ...signed(), signature: "wrong-signature-value" }],
    ];
    for (const [name, w, request] of requests) {
      await w.service.handle(request);
      const logged = JSON.stringify([w.lines, w.events]);
      expect(w.lines.length, name).toBeGreaterThan(0);
      for (const secret of [NUMBER, "4165550123", "6475550100", SECRET_TEXT, "secret resident text", request.signature ?? "no-signature", REF, SID, OTHER_SID, TOKEN]) {
        expect(logged, `${name}: ${secret}`).not.toContain(secret);
      }
    }
  });
});
