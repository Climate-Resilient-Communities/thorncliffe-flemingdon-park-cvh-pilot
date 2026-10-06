import { beforeEach, describe, expect, it, vi } from "vitest";

type Wiring = { oncall?: { required: () => boolean }; checkins?: { ensureRound: (tx: unknown, thread: unknown, ids: readonly string[]) => Promise<number> } };
const created: Wiring[] = [];
const ensureRound = vi.fn(async () => 2);
let env: { smsPricePerSegmentCents: number; smsMode: string; twilio?: { accountSid: string; authToken: string; messagingServiceSid: string } };

vi.mock("@/modules/alerting", () => ({
  createAlerting: (deps: Wiring) => {
    created.push(deps);
    return {};
  },
  createAlertSubmitter: () => ({}),
}));
vi.mock("@/platform/config/env", () => ({ getEnv: () => env }));
vi.mock("@/platform/db", () => ({ getDb: () => ({}) }));
vi.mock("./alertTranslation", () => ({ alertTranslation: () => ({}) }));
vi.mock("./freezeEntry", () => ({ freezeEntryContent: () => ({}) }));
vi.mock("../checkins", () => ({ checkinRequests: () => ({ ensureRound }) }));

import { alerting, resetAlertsComposition } from "./alerts";

describe("the alerting composition root (S06.07)", () => {
  beforeEach(() => {
    created.length = 0;
    resetAlertsComposition();
  });

  it("wires the on-call rule to whether texting is live, read at the time of each approval", () => {
    env = { smsPricePerSegmentCents: 1, smsMode: "log" };
    alerting();
    const required = created[0]?.oncall?.required;
    expect(required).toBeTypeOf("function");
    expect(required?.()).toBe(false);
    env = { smsPricePerSegmentCents: 1, smsMode: "live", twilio: { accountSid: "AC1", authToken: "t", messagingServiceSid: "MG1" } };
    expect(required?.()).toBe(true);
    env = { smsPricePerSegmentCents: 1, smsMode: "live" };
    expect(required?.()).toBe(false);
  });

  it("S08.06: wires checkins' ensureRound, so an approval of a round type starts its check-in round in its own transaction", async () => {
    env = { smsPricePerSegmentCents: 1, smsMode: "log" };
    alerting();
    const thread = { alertId: "a", types: ["heat"], audience: {} };
    expect(await created[0]?.checkins?.ensureRound("tx", thread, ["s1"])).toBe(2);
    expect(ensureRound).toHaveBeenCalledWith("tx", thread, ["s1"]);
  });
});
