import { beforeEach, describe, expect, it, vi } from "vitest";

// The readings are the modules' own (tested against the database: test/db/subscriberMeasures.db.test.ts and deliveryMeasureViews.db.test.ts). This test is
// about who is given what (AD-4): the cost of an alert is read, and shown, only for a role that may see spend.
const calls = vi.hoisted(() => ({ cost: 0, cohere: 0, reach: 0, subscribers: 0 }));
vi.mock("@/platform/db", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/subscriptions", () => ({
  readSubscriberMeasures: async () => {
    calls.subscribers += 1;
    return { day: "2026-10-04", measures: [] };
  },
}));
vi.mock("@/modules/messaging", () => ({
  readCorrectionReach: async () => {
    calls.reach += 1;
    return { real: [], drills: [] };
  },
}));
vi.mock("@/modules/spend", () => ({
  readAlertCost: async () => {
    calls.cost += 1;
    return { real: [], drills: [] };
  },
  readCohereShare: async () => {
    calls.cohere += 1;
    return [];
  },
}));

const { loadMeasures } = await import("./load");

beforeEach(() => {
  calls.cost = 0;
  calls.cohere = 0;
  calls.reach = 0;
  calls.subscribers = 0;
});

describe("loadMeasures", () => {
  it("gives a Coordinator the counts and leaves the cost of alerts out, without reading it", async () => {
    const view = await loadMeasures("coordinator");
    expect(view.cost).toBeNull();
    expect(calls).toEqual({ cost: 0, cohere: 0, reach: 1, subscribers: 1 });
  });

  it.each(["director", "admin"] as const)("gives a %s the counts and the cost of alerts", async (role) => {
    const view = await loadMeasures(role);
    expect(view.cost).not.toBeNull();
    expect(calls).toEqual({ cost: 1, cohere: 1, reach: 1, subscribers: 1 });
  });
});
