import { describe, expect, it } from "vitest";
import { monthInterval } from "./reconciliation";
import { isOutbound, toActuals, type ProviderMessage } from "./smsActuals";

const october = monthInterval("2026-10");
const sid = (n: number) => `SM${n.toString(16).padStart(32, "0")}`;
const message = (n: number, over: Partial<ProviderMessage> = {}): ProviderMessage => ({
  sid: sid(n),
  direction: "outbound-api",
  dateSent: new Date("2026-10-15T14:00:00Z"),
  price: "-0.00790",
  priceUnit: "USD",
  ...over,
});

describe("the listing as actual prices (S06.08)", () => {
  it("converts every outbound message of the interval at the rate, labelled with the rate and the currency the provider used", () => {
    const result = toActuals(october, [message(1), message(2, { price: "-0.0158" })], 1.4);
    expect(result).toEqual({
      kind: "ok",
      outsideInterval: 0,
      actuals: [
        { messageSid: sid(1), sentAt: new Date("2026-10-15T14:00:00Z"), priceText: "-0.00790", priceUnit: "USD", rate: 1.4, cadMillicents: 1106 },
        { messageSid: sid(2), sentAt: new Date("2026-10-15T14:00:00Z"), priceText: "-0.0158", priceUnit: "USD", rate: 1.4, cadMillicents: 2212 },
      ],
    });
  });

  it("takes only outbound messages: an inbound one is not a text the app sent, and needs no price", () => {
    expect(isOutbound(message(1, { direction: "outbound-reply" }))).toBe(true);
    expect(isOutbound(message(1, { direction: "OUTBOUND-API" }))).toBe(true);
    expect(isOutbound(message(1, { direction: "inbound" }))).toBe(false);
    const result = toActuals(october, [message(1), message(2, { direction: "inbound", price: null, dateSent: null, sid: "" })], 1.4);
    expect(result).toMatchObject({ kind: "ok" });
    expect(result.kind === "ok" && result.actuals.map((a) => a.messageSid)).toEqual([sid(1)]);
  });

  it("keeps the exact interval: the first instant is in, the first instant of the next month is not, and what is outside is counted and left alone", () => {
    const before = message(1, { dateSent: new Date(october.startUtc.getTime() - 1) });
    const first = message(2, { dateSent: october.startUtc });
    const last = message(3, { dateSent: new Date(october.endUtc.getTime() - 1) });
    const after = message(4, { dateSent: october.endUtc });
    // The messages outside have no price yet; they are another reconciliation's, so they do not make this one pending.
    const result = toActuals(october, [before, first, last, after].map((m) => (m.sid === sid(1) || m.sid === sid(4) ? { ...m, price: null } : m)), 1.4);
    expect(result.kind === "ok" && result.actuals.map((a) => a.messageSid)).toEqual([sid(2), sid(3)]);
    expect(result.kind === "ok" && result.outsideInterval).toBe(2);
  });

  it("is one message when the listing gives it twice (the list moved while it was read)", () => {
    const result = toActuals(october, [message(1), message(1), message(2)], 1.4);
    expect(result.kind === "ok" && result.actuals.map((a) => a.messageSid)).toEqual([sid(1), sid(2)]);
  });

  it("is an empty import for an interval with no messages", () => {
    expect(toActuals(october, [], 1.4)).toEqual({ kind: "ok", actuals: [], outsideInterval: 0 });
  });

  it("cannot be applied while a message has no price yet", () => {
    expect(toActuals(october, [message(1), message(2, { price: null })], 1.4)).toEqual({ kind: "pending", reason: "message_without_price" });
    expect(toActuals(october, [message(2, { price: "" })], 1.4)).toEqual({ kind: "pending", reason: "message_without_price" });
  });

  it("cannot be applied with a price it cannot convert", () => {
    expect(toActuals(october, [message(1, { price: "free" })], 1.4)).toEqual({ kind: "pending", reason: "price_unusable" });
    expect(toActuals(october, [message(1, { priceUnit: "EUR" })], 1.4)).toEqual({ kind: "pending", reason: "price_unusable" });
    expect(toActuals(october, [message(1, { priceUnit: null })], 1.4)).toEqual({ kind: "pending", reason: "price_unusable" });
  });

  it("cannot be applied with a message that has no id or no send time", () => {
    expect(toActuals(october, [message(1, { sid: "SM123" })], 1.4)).toEqual({ kind: "pending", reason: "message_malformed" });
    expect(toActuals(october, [message(1, { sid: "" })], 1.4)).toEqual({ kind: "pending", reason: "message_malformed" });
    expect(toActuals(october, [message(1, { dateSent: null })], 1.4)).toEqual({ kind: "pending", reason: "message_malformed" });
    expect(toActuals(october, [message(1, { dateSent: new Date("nonsense") })], 1.4)).toEqual({ kind: "pending", reason: "message_malformed" });
  });

  it("names the most serious problem when there are several: malformed, then no price, then unusable", () => {
    const unpriced = message(1, { price: null });
    const unusable = message(2, { priceUnit: "EUR" });
    const malformed = message(3, { sid: "x" });
    expect(toActuals(october, [unusable, unpriced], 1.4)).toMatchObject({ reason: "message_without_price" });
    expect(toActuals(october, [unusable, unpriced, malformed], 1.4)).toMatchObject({ reason: "message_malformed" });
    expect(toActuals(october, [unusable], 1.4)).toMatchObject({ reason: "price_unusable" });
  });
});
