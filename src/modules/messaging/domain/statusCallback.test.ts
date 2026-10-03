import { describe, expect, it } from "vitest";
import { DELIVERY_STATES, TERMINAL_STATES, canTransition, type DeliveryState } from "./deliveryState";
import { statusCallbackUrl } from "./dispatchRules";
import {
  CALLBACK_TARGETS,
  NON_TERMINAL_CALLBACK_STATUSES,
  STATUS_CALLBACK_PATH,
  TERMINAL_CALLBACK_STATUSES,
  callbackTarget,
  decideCallback,
  parseCallbackPayload,
  readCallbackRef,
  type CallbackPayload,
  type CallbackRow,
  type CallbackTarget,
} from "./statusCallback";

const SID = "SM0123456789abcdef0123456789abcdef";
const OTHER_SID = "SMffffffffffffffffffffffffffffffff";
const REF = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

const form = (fields: Record<string, string | string[]>) => {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) for (const one of Array.isArray(value) ? value : [value]) params.append(name, one);
  return params;
};

describe("which state a status stands for", () => {
  it("maps the terminal statuses to themselves and the non-terminal ones (queued, sending, sent, and the Messaging Service's accepted and scheduled) to submitted", () => {
    for (const status of TERMINAL_CALLBACK_STATUSES) expect(callbackTarget(status)).toBe(status);
    for (const status of ["queued", "sending", "sent", "accepted", "scheduled"]) expect(callbackTarget(status), status).toBe("submitted");
    expect([...NON_TERMINAL_CALLBACK_STATUSES].sort()).toEqual(["accepted", "queued", "scheduled", "sending", "sent"]);
  });

  it("does not know any other word: not a read receipt, a cancelled scheduled text, an inbound status, a different case or nothing", () => {
    for (const status of ["read", "canceled", "receiving", "received", "partially_delivered", "DELIVERED", "Delivered", " delivered", "", "delivered ", "unknown", "claimed", "cancelled"]) {
      expect(callbackTarget(status), JSON.stringify(status)).toBeNull();
    }
  });

  it("only ever asks for states the transition table allows from an unresolved state", () => {
    for (const target of CALLBACK_TARGETS) {
      const reachableFrom = DELIVERY_STATES.filter((from) => canTransition(from, target));
      expect(reachableFrom.length, target).toBeGreaterThan(0);
      for (const from of reachableFrom) expect(["claimed", "submitted", "unknown"], `${from} to ${target}`).toContain(from);
    }
  });
});

describe("the reference in the callback URL", () => {
  it("reads exactly one reference shaped like a delivery's, lower-cased", () => {
    expect(readCallbackRef(`?ref=${REF}`)).toEqual({ kind: "ref", ref: REF });
    expect(readCallbackRef(`ref=${REF}`)).toEqual({ kind: "ref", ref: REF });
    expect(readCallbackRef(`?ref=${REF.toUpperCase()}`)).toEqual({ kind: "ref", ref: REF });
  });

  it("says there is none for no query, no ref, or an empty one", () => {
    for (const search of ["", "?", "?other=1", "?ref=", "?ref=&other=1"]) expect(readCallbackRef(search), search).toEqual({ kind: "none" });
  });

  it("calls a repeated reference or one that is not a UUID unusable, so the database is never asked about it", () => {
    for (const search of [`?ref=${REF}&ref=${REF}`, "?ref=abc", "?ref=1", `?ref=${REF}x`, `?ref=${REF.slice(1)}`, "?ref=%27%3B%20drop%20table%20delivery%3B--", `?ref=${REF}&ref=`, `?ref=&ref=${REF}`]) {
      expect(readCallbackRef(search), search).toEqual({ kind: "unusable" });
    }
  });

  it("reads the reference the dispatcher puts in the URL it gives Twilio", () => {
    const url = new URL(statusCallbackUrl("https://cvh.example/", REF));
    expect(url.pathname).toBe(STATUS_CALLBACK_PATH);
    expect(readCallbackRef(url.search)).toEqual({ kind: "ref", ref: REF });
  });
});

describe("what a status callback says", () => {
  it("takes the message id, the state its status stands for and, for a failure, the error code", () => {
    expect(parseCallbackPayload(form({ MessageSid: SID, MessageStatus: "delivered" }))).toEqual({ messageSid: SID, target: "delivered", errorCode: null });
    expect(parseCallbackPayload(form({ MessageSid: SID, MessageStatus: "undelivered", ErrorCode: "30003" }))).toEqual({ messageSid: SID, target: "undelivered", errorCode: 30003 });
    expect(parseCallbackPayload(form({ MessageSid: SID, MessageStatus: "sent" }))).toEqual({ messageSid: SID, target: "submitted", errorCode: null });
  });

  it("reads nothing else of the body: the number, the text and every other field are not looked at", () => {
    const payload = parseCallbackPayload(form({ MessageSid: SID, MessageStatus: "delivered", To: "+14165550123", From: "+16475550100", Body: "secret text", AccountSid: "AC1" }));
    expect(JSON.stringify(payload)).not.toMatch(/4165550123|6475550100|secret|AC1/);
    expect(Object.keys(payload as CallbackPayload).sort()).toEqual(["errorCode", "messageSid", "target"]);
  });

  it.each([
    ["no message id", { MessageStatus: "delivered" }],
    ["no status", { MessageSid: SID }],
    ["a message id that is not the database's shape", { MessageSid: "SM123", MessageStatus: "delivered" }],
    ["an account id where a message id belongs", { MessageSid: `AC${"0".repeat(32)}`, MessageStatus: "delivered" }],
    ["a message id in capitals", { MessageSid: `SM${"A".repeat(32)}`, MessageStatus: "delivered" }],
    ["a status it does not know", { MessageSid: SID, MessageStatus: "read" }],
    ["two message ids", { MessageSid: [SID, OTHER_SID], MessageStatus: "delivered" }],
    ["two statuses", { MessageSid: SID, MessageStatus: ["sent", "delivered"] }],
    ["the legacy fields only", { SmsSid: SID, SmsStatus: "delivered" }],
  ])("is not usable with %s", (_name, fields) => {
    expect(parseCallbackPayload(form(fields))).toBeNull();
  });

  it("keeps an error code only if the table can hold it (1 to 99999, digits only), and still accepts the callback without it", () => {
    for (const [code, expected] of [["30003", 30003], ["1", 1], ["99999", 99999], ["0", null], ["100000", null], ["-5", null], ["3.5", null], ["30003x", null], ["", null], ["٣٠٠٠٣", null]] as const) {
      expect(parseCallbackPayload(form({ MessageSid: SID, MessageStatus: "failed", ErrorCode: code }))?.errorCode, code).toBe(expected);
    }
    expect(parseCallbackPayload(form({ MessageSid: SID, MessageStatus: "failed", ErrorCode: ["1", "2"] }))?.errorCode).toBeNull();
  });
});

describe("what a callback does to a delivery", () => {
  const payload = (target: CallbackTarget, over: Partial<CallbackPayload> = {}): CallbackPayload => ({ messageSid: SID, target, errorCode: null, ...over });
  const row = (state: DeliveryState, over: Partial<CallbackRow> = {}): CallbackRow => ({ state, handedOff: true, submitted: false, providerMessageId: null, ...over });

  it("moves a handed-off claimed row to the status of the callback, and stores the message id the row lacks", () => {
    for (const target of CALLBACK_TARGETS) {
      expect(decideCallback(row("claimed"), payload(target)), target).toEqual({ kind: "apply", from: "claimed", to: target, storeProviderId: true, resolvesUnknown: false, errorCode: null });
    }
  });

  it("moves an unknown row to the status of the callback and says it was resolved", () => {
    for (const target of CALLBACK_TARGETS) {
      expect(decideCallback(row("unknown"), payload(target)), target).toMatchObject({ kind: "apply", from: "unknown", to: target, resolvesUnknown: true, storeProviderId: true });
    }
    expect(decideCallback(row("unknown", { providerMessageId: SID }), payload("delivered"))).toMatchObject({ kind: "apply", storeProviderId: false, resolvesUnknown: true });
  });

  it("moves an unknown row that was once submitted (it aged out after 24 hours) only on a final status: a non-terminal one changes nothing, however often it is repeated", () => {
    const agedOut = row("unknown", { submitted: true, providerMessageId: SID });
    expect(decideCallback(agedOut, payload("submitted"))).toEqual({ kind: "ignore", reason: "no_change" });
    for (const target of ["delivered", "undelivered", "failed"] as const) {
      expect(decideCallback(agedOut, payload(target)), target).toMatchObject({ kind: "apply", from: "unknown", to: target, storeProviderId: false, resolvesUnknown: true });
    }
    // The rule is about the row having been submitted, not about its id: the same row without one (never given by the database, but the rule does not lean on it).
    expect(decideCallback(row("unknown", { submitted: true }), payload("submitted"))).toEqual({ kind: "ignore", reason: "no_change" });
    // An unknown that never reached `submitted` (made by the sweep after a hand-off with no answer, or by a timeout) still moves to it.
    expect(decideCallback(row("unknown", { submitted: false }), payload("submitted"))).toMatchObject({ kind: "apply", from: "unknown", to: "submitted", resolvesUnknown: true, storeProviderId: true });
    // A mismatch is still a mismatch, and a claimed or submitted row is not affected by the flag.
    expect(decideCallback(row("unknown", { submitted: true, providerMessageId: OTHER_SID }), payload("submitted"))).toEqual({ kind: "mismatch" });
    expect(decideCallback(row("claimed", { submitted: true }), payload("submitted"))).toMatchObject({ kind: "apply", from: "claimed", to: "submitted" });
  });

  it("moves a submitted row only to a terminal state; a non-terminal status after it adds nothing", () => {
    for (const target of ["delivered", "undelivered", "failed"] as const) {
      expect(decideCallback(row("submitted", { providerMessageId: SID }), payload(target)), target).toMatchObject({ kind: "apply", from: "submitted", to: target, storeProviderId: false, resolvesUnknown: false });
    }
    expect(decideCallback(row("submitted", { providerMessageId: SID }), payload("submitted"))).toEqual({ kind: "ignore", reason: "no_change" });
  });

  it("keeps Twilio's error code for failed and undelivered only", () => {
    expect(decideCallback(row("claimed"), payload("undelivered", { errorCode: 30005 }))).toMatchObject({ errorCode: 30005 });
    expect(decideCallback(row("claimed"), payload("failed", { errorCode: 30008 }))).toMatchObject({ errorCode: 30008 });
    expect(decideCallback(row("claimed"), payload("delivered", { errorCode: 30005 }))).toMatchObject({ errorCode: null });
    expect(decideCallback(row("claimed"), payload("submitted", { errorCode: 30005 }))).toMatchObject({ errorCode: null });
  });

  it("never changes a terminal row: a repeat, a late non-terminal status and any other status change nothing", () => {
    for (const state of TERMINAL_STATES) {
      for (const target of CALLBACK_TARGETS) {
        const decision = decideCallback(row(state, { providerMessageId: SID }), payload(target));
        expect(decision, `${state} with ${target}`).toEqual({ kind: "ignore", reason: "final" });
      }
    }
  });

  it("does not move a row that was never handed to the provider, or ended without an id: a callback for it is a surprise, not a repeat", () => {
    for (const target of CALLBACK_TARGETS) {
      expect(decideCallback(row("queued", { handedOff: false }), payload(target))).toEqual({ kind: "ignore", reason: "not_in_flight" });
      expect(decideCallback(row("claimed", { handedOff: false }), payload(target))).toEqual({ kind: "ignore", reason: "not_in_flight" });
      for (const state of TERMINAL_STATES) expect(decideCallback(row(state), payload(target)), `${state} with no id`).toEqual({ kind: "ignore", reason: "not_in_flight" });
    }
  });

  it("changes nothing and reports a mismatch when the row has another provider id, whatever its state and the status", () => {
    for (const state of DELIVERY_STATES) {
      for (const target of CALLBACK_TARGETS) {
        expect(decideCallback(row(state, { providerMessageId: OTHER_SID }), payload(target)), `${state} with ${target}`).toEqual({ kind: "mismatch" });
      }
    }
  });

  it("applies only moves the transition table has, from every state, with every status (the table is the limit)", () => {
    for (const state of DELIVERY_STATES) {
      for (const target of CALLBACK_TARGETS) {
        for (const providerMessageId of [null, SID]) {
          const decision = decideCallback(row(state, { providerMessageId }), payload(target));
          if (decision.kind === "apply") {
            expect(canTransition(decision.from, decision.to), `${state} to ${target}`).toBe(true);
            expect(decision.from).toBe(state);
            expect(decision.storeProviderId).toBe(providerMessageId === null);
          }
        }
      }
    }
  });

  it("applies exactly the callback rows of the transition table: claimed, submitted and unknown to a final state, claimed and unknown to submitted", () => {
    const applied: string[] = [];
    for (const state of DELIVERY_STATES) {
      for (const target of CALLBACK_TARGETS) {
        if (decideCallback(row(state, { providerMessageId: state === "submitted" ? SID : null }), payload(target)).kind === "apply") applied.push(`${state}>${target}`);
      }
    }
    expect(applied.sort()).toEqual(
      [
        "claimed>submitted",
        "claimed>delivered",
        "claimed>undelivered",
        "claimed>failed",
        "unknown>submitted",
        "unknown>delivered",
        "unknown>undelivered",
        "unknown>failed",
        "submitted>delivered",
        "submitted>undelivered",
        "submitted>failed",
      ].sort(),
    );
  });

  it("applies the same rows for a row that was once submitted, except that an unknown one no longer goes back to submitted", () => {
    const applied: string[] = [];
    for (const state of DELIVERY_STATES) {
      for (const target of CALLBACK_TARGETS) {
        if (decideCallback(row(state, { submitted: true, providerMessageId: SID }), payload(target)).kind === "apply") applied.push(`${state}>${target}`);
      }
    }
    expect(applied.sort()).toEqual(
      ["claimed>submitted", "claimed>delivered", "claimed>undelivered", "claimed>failed", "unknown>delivered", "unknown>undelivered", "unknown>failed", "submitted>delivered", "submitted>undelivered", "submitted>failed"].sort(),
    );
  });
});
