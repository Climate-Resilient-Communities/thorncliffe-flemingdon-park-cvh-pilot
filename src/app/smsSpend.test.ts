import { describe, expect, it, vi } from "vitest";
import { appSmsSpend } from "./smsSpend";

vi.mock("@/platform/config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/platform/config/env")>()),
  getEnv: () => ({ smsPricePerSegmentCents: 1.5 }),
}));

describe("the spend hooks of the app (S06.08)", () => {
  it("are one pair of functions, made from the environment's price per segment, for the dispatcher and the status callbacks", () => {
    const hooks = appSmsSpend();
    expect(typeof hooks.afterOutcome).toBe("function");
    expect(typeof hooks.afterProviderId).toBe("function");
    expect(typeof appSmsSpend({ smsPricePerSegmentCents: 2.25 }).afterOutcome).toBe("function");
  });

  it("stop the sender where it starts when the price is not valid, not in the middle of an outcome", () => {
    for (const smsPricePerSegmentCents of [0, -1, 1.2345, Number.NaN]) expect(() => appSmsSpend({ smsPricePerSegmentCents }), String(smsPricePerSegmentCents)).toThrow(RangeError);
  });
});
