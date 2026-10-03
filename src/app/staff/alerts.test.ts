import { beforeEach, describe, expect, it, vi } from "vitest";

const created: Array<{ oncall?: { required: () => boolean } }> = [];
let env: { smsPricePerSegmentCents: number; smsMode: string; twilio?: { accountSid: string; authToken: string; messagingServiceSid: string } };

vi.mock("@/modules/alerting", () => ({
  createAlerting: (deps: { oncall?: { required: () => boolean } }) => {
    created.push(deps);
    return {};
  },
  createAlertSubmitter: () => ({}),
}));
vi.mock("@/platform/config/env", () => ({ getEnv: () => env }));
vi.mock("@/platform/db", () => ({ getDb: () => ({}) }));
vi.mock("./alertTranslation", () => ({ alertTranslation: () => ({}) }));
vi.mock("./freezeEntry", () => ({ freezeEntryContent: () => ({}) }));

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
});
