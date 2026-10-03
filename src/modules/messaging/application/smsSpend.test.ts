import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbTransaction } from "../../../platform/db";
import type { DeliveryView } from "./deliveryPorts";

// The spend module is replaced by a recorder: what the hooks ask it to write is the whole of what they do. The writes themselves, in a real
// database, are proved by test/db/smsSpend.db.test.ts.
const spend = vi.hoisted(() => ({ estimates: [] as unknown[], retirements: [] as unknown[][], fail: false }));
vi.mock("../../spend", () => ({
  recordSmsEstimate: async (_tx: unknown, input: unknown) => {
    if (spend.fail) throw new Error("the spend_event insert failed");
    spend.estimates.push(input);
    return { recorded: true };
  },
  retireSmsEstimates: async (_tx: unknown, pairs: unknown[]) => {
    spend.retirements.push(pairs);
    return pairs.length;
  },
}));

const { createSmsSpendHooks, smsEstimateCents } = await import("./smsSpend");

const TX = {} as DbTransaction;
const SID = `SM${"ab".repeat(16)}`;
const delivery = (over: Partial<DeliveryView> = {}): DeliveryView =>
  ({
    id: "01900000-0000-7000-8000-0000000d0001",
    kind: "alert",
    recipientKind: "subscriber",
    recipientId: "01900000-0000-7000-8000-0000000a0001",
    entryId: "01900000-0000-7000-8000-0000000e0001",
    lang: "ur",
    segments: 2,
    ...over,
  }) as DeliveryView;

const hooks = (providerId: string | null = SID, price = 1.5, now?: () => Date) => {
  const read = vi.fn(async () => providerId);
  return { read, hooks: createSmsSpendHooks({ store: { providerIdOf: read }, pricePerSegmentCents: price, now }) };
};

beforeEach(() => {
  spend.estimates.length = 0;
  spend.retirements.length = 0;
  spend.fail = false;
});

describe("a text's estimate (S06.08)", () => {
  it("is segments x the configured price per segment, in whole cents, rounded up so it never understates", () => {
    expect(smsEstimateCents(1, "en", 1.5)).toBe(2);
    expect(smsEstimateCents(2, "ur", 1.5)).toBe(3);
    expect(smsEstimateCents(3, "ur", 1.5)).toBe(5);
    expect(smsEstimateCents(4, "en", 1.5)).toBe(6);
    expect(smsEstimateCents(1, "en", 1.25)).toBe(2);
    expect(smsEstimateCents(10, "en", 1.234)).toBe(13);
    expect(smsEstimateCents(24, "zh-Hant", 100)).toBe(2400);
  });

  it("is written with the delivery, its language, its entry and its segments when the outcome is recorded, for a submitted text and for an unknown one", async () => {
    const { hooks: spendHooks } = hooks();
    await spendHooks.afterOutcome(TX, delivery(), "submitted");
    await spendHooks.afterOutcome(TX, delivery({ id: "01900000-0000-7000-8000-0000000d0002", segments: 1, lang: "en" }), "unknown");
    expect(spend.estimates).toEqual([
      { deliveryId: "01900000-0000-7000-8000-0000000d0001", entryId: "01900000-0000-7000-8000-0000000e0001", lang: "ur", isDrill: false, segments: 2, costCents: 3, purpose: "alert" },
      { deliveryId: "01900000-0000-7000-8000-0000000d0002", entryId: "01900000-0000-7000-8000-0000000e0001", lang: "en", isDrill: false, segments: 1, costCents: 2, purpose: "alert" },
    ]);
  });

  it("is marked a drill when the text went to the drill roster, and has no entry when it is not an alert", async () => {
    const { hooks: spendHooks } = hooks();
    await spendHooks.afterOutcome(TX, delivery({ recipientKind: "roster" }), "submitted");
    await spendHooks.afterOutcome(TX, delivery({ kind: "transactional", entryId: null, purpose: "menu_reply" }), "submitted");
    await spendHooks.afterOutcome(TX, delivery({ kind: "campaign", entryId: null }), "submitted");
    expect(spend.estimates).toMatchObject([
      { isDrill: true, purpose: "alert" },
      { isDrill: false, entryId: null, purpose: "transactional" },
      { isDrill: false, entryId: null, purpose: "campaign" },
    ]);
  });

  it("takes the database's clock unless a test gives one", async () => {
    await hooks().hooks.afterOutcome(TX, delivery(), "submitted");
    expect(spend.estimates[0]).not.toHaveProperty("at");
    const at = new Date("2026-11-01T04:00:01Z");
    await hooks(SID, 1.5, () => at).hooks.afterOutcome(TX, delivery(), "submitted");
    expect(spend.estimates[1]).toMatchObject({ at });
  });

  it("runs the matching rule for the delivery it has just counted, with the provider id read from the delivery row (never one a caller passes)", async () => {
    const { hooks: spendHooks, read } = hooks(SID);
    await spendHooks.afterOutcome(TX, delivery({ providerMessageId: `SM${"00".repeat(16)}` }), "submitted");
    expect(read).toHaveBeenCalledWith(TX, "01900000-0000-7000-8000-0000000d0001");
    expect(spend.retirements).toEqual([[{ deliveryId: "01900000-0000-7000-8000-0000000d0001", messageSid: SID }]]);
  });

  it("runs no matching for a text that has no provider id (an ambiguous send): its estimate stays unresolved", async () => {
    await hooks(null).hooks.afterOutcome(TX, delivery(), "unknown");
    expect(spend.estimates).toHaveLength(1);
    expect(spend.retirements).toEqual([]);
  });

  it("runs the matching rule when a provider id is recorded later, and writes no estimate of its own", async () => {
    const { hooks: spendHooks } = hooks();
    await spendHooks.afterProviderId(TX, delivery());
    expect(spend.estimates).toEqual([]);
    expect(spend.retirements).toEqual([[{ deliveryId: "01900000-0000-7000-8000-0000000d0001", messageSid: SID }]]);
    spend.retirements.length = 0;
    await hooks(null).hooks.afterProviderId(TX, delivery());
    expect(spend.retirements).toEqual([]);
  });

  it("lets a failing write reach its caller, which owns the transaction and decides (the dispatcher rolls the outcome back; the sweep and the callbacks undo only the hook's writes)", async () => {
    spend.fail = true;
    await expect(hooks().hooks.afterOutcome(TX, delivery(), "submitted")).rejects.toThrow("the spend_event insert failed");
    expect(spend.retirements).toEqual([]);
  });

  it("refuses a price per segment that is not valid when it is built, so a misconfigured app stops where it starts", () => {
    for (const price of [0, -1, 1.2345, Number.NaN]) {
      expect(() => createSmsSpendHooks({ store: { providerIdOf: async () => null }, pricePerSegmentCents: price }), String(price)).toThrow(RangeError);
    }
  });
});
