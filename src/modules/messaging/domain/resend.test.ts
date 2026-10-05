import { describe, expect, it } from "vitest";
import { PROBLEM_MEANINGS } from "./sendingProgress";
import { MAX_ATTEMPTS } from "./dispatchRules";
import {
  BULK_RESEND_STATES,
  RESENDABLE_STATES,
  RESEND_LIMIT,
  RESEND_REFUSALS,
  UNRECEIVABLE_MEANINGS,
  decideResend,
  latestOf,
  resendKey,
  unreceivableMeaning,
  type ChainText,
  type ResendFacts,
} from "./resend";

const text = (id: string, over: Partial<ChainText> = {}): ChainText => ({ id, state: "failed", resendN: null, providerErrorCode: null, attempts: 1, ...over });

const facts = (over: Partial<ResendFacts> & { chain?: ChainText[] } = {}): ResendFacts => {
  const chain = over.chain ?? [text("root")];
  return { target: chain.at(-1)!.id, chain, recipientId: "recipient", recipientIsSubscriber: true, seen: null, confirmedUnknown: false, ...over };
};

describe("the rules of a resend", () => {
  it("keeps the key the weekly review reads (resend:{root}:{n}) and the chain's limit of two", () => {
    expect(resendKey("0190c3f2-7a1b-7c3d-8e4f-a1b2c3d4e5f6", 2)).toBe("resend:0190c3f2-7a1b-7c3d-8e4f-a1b2c3d4e5f6:2");
    expect(RESEND_LIMIT).toBe(2);
  });

  it("resends a text that failed, was undelivered or is unknown, and a bulk resend takes the first two only", () => {
    expect([...RESENDABLE_STATES]).toEqual(["failed", "undelivered", "unknown"]);
    expect([...BULK_RESEND_STATES]).toEqual(["failed", "undelivered"]);
  });

  it("names every reason it can refuse for", () => {
    expect([...RESEND_REFUSALS].sort()).toEqual(
      ["already_resent", "cannot_receive", "confirm_needed", "not_found", "not_resendable", "not_sendable", "recipient_gone", "recipient_not_receiving", "resend_limit", "status_changed"].sort(),
    );
  });

  it("holds the unreceivable meanings among the provider meanings the Hub knows", () => {
    for (const meaning of UNRECEIVABLE_MEANINGS) expect(PROBLEM_MEANINGS).toContain(meaning);
  });
});

describe("which row of a chain is the latest", () => {
  it("is the root when there are no resends, else the highest resend number", () => {
    expect(latestOf([])).toBeNull();
    expect(latestOf([text("root")])?.id).toBe("root");
    expect(latestOf([text("root"), text("a", { resendN: 1 }), text("b", { resendN: 2 })])?.id).toBe("b");
    expect(latestOf([text("b", { resendN: 2 }), text("root"), text("a", { resendN: 1 })])?.id).toBe("b");
  });
});

describe("what the provider's error says about the number", () => {
  it.each([
    [30005, "failed", "not_in_service"],
    [21211, "failed", "invalid_number"],
    [30006, "undelivered", "landline"],
    [21610, "failed", "opted_out"],
  ] as const)("error %i (%s) is %s: the number cannot receive texts", (code, state, meaning) => {
    expect(unreceivableMeaning({ state, providerErrorCode: code, attempts: 1 })).toBe(meaning);
  });

  it("does not say it of a phone that was off, a provider that was busy, a code nobody knows, no reason or a text that is unknown", () => {
    for (const code of [30003, 30001, 99999, null]) expect(unreceivableMeaning({ state: "failed", providerErrorCode: code, attempts: 1 })).toBeNull();
    expect(unreceivableMeaning({ state: "failed", providerErrorCode: null, attempts: MAX_ATTEMPTS })).toBeNull();
    expect(unreceivableMeaning({ state: "unknown", providerErrorCode: 21610, attempts: 1 })).toBeNull();
    expect(unreceivableMeaning({ state: "delivered", providerErrorCode: 21610, attempts: 1 })).toBeNull();
  });
});

describe("whether a text is resent", () => {
  it("allows the first resend of a failed text, as resend 1", () => {
    expect(decideResend(facts())).toEqual({ ok: true, next: 1 });
  });

  it("allows a resend of a resend as resend 2, whichever row the Admin chose, once it is the chain's latest", () => {
    const chain = [text("root"), text("a", { resendN: 1 })];
    expect(decideResend(facts({ chain }))).toEqual({ ok: true, next: 2 });
  });

  it("refuses a third resend of any row of a chain with two", () => {
    const chain = [text("root"), text("a", { resendN: 1 }), text("b", { resendN: 2 })];
    expect(decideResend(facts({ chain, target: "b" }))).toEqual({ ok: false, reason: "resend_limit" });
    // An older row is no longer the chain's latest.
    expect(decideResend(facts({ chain, target: "root" }))).toMatchObject({ ok: false, reason: "already_resent" });
    expect(decideResend(facts({ chain, target: "a" }))).toMatchObject({ ok: false, reason: "already_resent" });
  });

  it("refuses a text that has been resent since: it would be sent twice", () => {
    const chain = [text("root"), text("a", { resendN: 1, state: "queued" })];
    expect(decideResend(facts({ chain, target: "root" }))).toEqual({ ok: false, reason: "already_resent", status: "queued" });
  });

  it.each(["queued", "claimed", "submitted", "delivered", "cancelled", "skipped", "skipped_env"] as const)("refuses a text that is %s, with its status", (state) => {
    expect(decideResend(facts({ chain: [text("root", { state })] }))).toEqual({ ok: false, reason: "not_resendable", status: state });
  });

  it("refuses an unknown text without the Admin's confirmation, and allows it with", () => {
    const chain = [text("root", { state: "unknown" })];
    expect(decideResend(facts({ chain, seen: "unknown" }))).toEqual({ ok: false, reason: "confirm_needed", status: "unknown" });
    expect(decideResend(facts({ chain, seen: "unknown", confirmedUnknown: true }))).toEqual({ ok: true, next: 1 });
  });

  it("refuses with the new status when the text is not the status the Admin saw", () => {
    expect(decideResend(facts({ chain: [text("root", { state: "delivered" })], seen: "unknown", confirmedUnknown: true }))).toEqual({ ok: false, reason: "status_changed", status: "delivered" });
    expect(decideResend(facts({ chain: [text("root", { state: "failed" })], seen: "unknown", confirmedUnknown: true }))).toEqual({ ok: false, reason: "status_changed", status: "failed" });
    expect(decideResend(facts({ chain: [text("root", { state: "failed" })], seen: "failed" }))).toEqual({ ok: true, next: 1 });
  });

  it("refuses a number that cannot receive texts with why, from any text of the chain", () => {
    expect(decideResend(facts({ chain: [text("root", { providerErrorCode: 21211 })] }))).toEqual({ ok: false, reason: "cannot_receive", meaning: "invalid_number" });
    const chain = [text("root", { providerErrorCode: 21610 }), text("a", { resendN: 1, state: "unknown" })];
    expect(decideResend(facts({ chain, confirmedUnknown: true }))).toEqual({ ok: false, reason: "cannot_receive", meaning: "opted_out" });
  });

  it("refuses a recipient who is gone before anything else, and a text that is not to a resident", () => {
    expect(decideResend(facts({ recipientId: null, chain: [text("root", { state: "delivered" })] }))).toEqual({ ok: false, reason: "recipient_gone" });
    expect(decideResend(facts({ recipientIsSubscriber: false }))).toMatchObject({ ok: false, reason: "not_resendable" });
  });

  it("refuses a text that is not in the chain", () => {
    expect(decideResend(facts({ target: "other" }))).toEqual({ ok: false, reason: "not_found" });
  });
});
