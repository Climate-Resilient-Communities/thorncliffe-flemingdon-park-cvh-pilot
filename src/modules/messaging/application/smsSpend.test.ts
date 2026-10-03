import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbTransaction } from "../../../platform/db";
import type { DeliveryView } from "./deliveryPorts";

// The spend module is replaced by a recorder: what the hooks ask it to write is the whole of what they do. The writes themselves, in a real
// database, are proved by test/db/smsSpend.db.test.ts.
const spend = vi.hoisted(() => ({ estimates: [] as unknown[], retirements: [] as unknown[][], fail: false, failRetire: false }));
vi.mock("../../spend", () => ({
  recordSmsEstimate: async (_tx: unknown, input: unknown) => {
    if (spend.fail) throw new Error("the spend_event insert failed");
    spend.estimates.push(input);
    return { recorded: true };
  },
  retireSmsEstimates: async (_tx: unknown, pairs: unknown[]) => {
    if (spend.failRetire) throw Object.assign(new Error("the retirement insert failed, SM123 +14165550123"), { name: "PostgresError" });
    spend.retirements.push(pairs);
    return pairs.length;
  },
}));

const { createSmsSpendHooks, smsEstimateCents } = await import("./smsSpend");

/** A transaction that opens a savepoint as a real one does: the callback's failure is the savepoint's, and rolls back its own writes only. */
const savepoints = { opened: 0, rolledBack: 0 };
const TX = {
  transaction: async (run: (savepoint: DbTransaction) => Promise<unknown>) => {
    savepoints.opened += 1;
    try {
      return await run(TX);
    } catch (error) {
      savepoints.rolledBack += 1;
      throw error;
    }
  },
} as unknown as DbTransaction;
const logged: { evt: string; fields: Record<string, unknown> }[] = [];
const log = { error: (evt: string, fields: Record<string, unknown>) => void logged.push({ evt, fields }) };
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
  return { read, hooks: createSmsSpendHooks({ store: { providerIdOf: read }, pricePerSegmentCents: price, now, log }) };
};

beforeEach(() => {
  spend.estimates.length = 0;
  spend.retirements.length = 0;
  spend.fail = false;
  spend.failRetire = false;
  savepoints.opened = 0;
  savepoints.rolledBack = 0;
  logged.length = 0;
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

  it("runs the matching in a savepoint, so a matching that fails loses only its own writes: the estimate is written, the hook does not throw, and the failure is logged by hook, delivery and error name", async () => {
    spend.failRetire = true;
    const { hooks: spendHooks } = hooks();
    await expect(spendHooks.afterOutcome(TX, delivery(), "submitted")).resolves.toBeUndefined();
    // The provider's outcome and the estimate belong to the caller's transaction, which this does not undo.
    expect(spend.estimates).toHaveLength(1);
    expect(savepoints).toEqual({ opened: 1, rolledBack: 1 });
    expect(logged).toEqual([{ evt: "spend.match_failed", fields: { hook: "outcome", delivery_id: "01900000-0000-7000-8000-0000000d0001", error: "PostgresError" } }]);
    // Never the database's message, which can quote a provider id or a number.
    expect(JSON.stringify(logged)).not.toMatch(/SM123|5550123|insert failed/);
  });

  it("opens that savepoint for every counted text, and logs nothing when the matching works", async () => {
    const { hooks: spendHooks } = hooks();
    await spendHooks.afterOutcome(TX, delivery(), "submitted");
    await spendHooks.afterOutcome(TX, delivery(), "unknown");
    expect(savepoints).toEqual({ opened: 2, rolledBack: 0 });
    expect(logged).toEqual([]);
  });

  it("does not guard the matching of afterProviderId: its callers (the dispatcher and the callbacks) run it in their own savepoint and log it as their own", async () => {
    spend.failRetire = true;
    await expect(hooks().hooks.afterProviderId(TX, delivery())).rejects.toThrow("the retirement insert failed");
    expect(logged).toEqual([]);
  });

  it("takes a delivery and an entry whose ids are not RFC-versioned uuids (any 8-4-4-4-12 hex the database's uuid column holds): the estimate rides in the outcome write and is never what fails it", async () => {
    const { hooks: spendHooks } = hooks();
    await spendHooks.afterOutcome(TX, delivery({ id: "00000000-0000-0000-0000-000000000001", entryId: "ffffffff-ffff-ffff-ffff-ffffffffffff" }), "submitted");
    expect(spend.estimates).toMatchObject([{ deliveryId: "00000000-0000-0000-0000-000000000001", entryId: "ffffffff-ffff-ffff-ffff-ffffffffffff" }]);
  });

  it("lets a failing write reach its caller, which owns the transaction and decides (the dispatcher rolls the outcome back; the sweep and the callbacks undo only the hook's writes)", async () => {
    spend.fail = true;
    await expect(hooks().hooks.afterOutcome(TX, delivery(), "submitted")).rejects.toThrow("the spend_event insert failed");
    expect(spend.retirements).toEqual([]);
  });

  it("refuses a price per segment that is not valid when it is built, so a misconfigured app stops where it starts", () => {
    for (const price of [0, -1, 1.2345, Number.NaN]) {
      expect(() => createSmsSpendHooks({ store: { providerIdOf: async () => null }, pricePerSegmentCents: price, log }), String(price)).toThrow(RangeError);
    }
  });
});
