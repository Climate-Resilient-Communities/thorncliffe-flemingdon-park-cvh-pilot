import { describe, expect, it } from "vitest";
import { uuidv7 } from "./ids";

describe("uuidv7", () => {
  it("writes the time, version and variant in their places", () => {
    const id = uuidv7(0x0190_1234_5678, new Uint8Array(10).fill(0xff));

    expect(id).toBe("01901234-5678-7fff-bfff-ffffffffffff");
  });

  it("is a valid UUID that sorts by creation time", () => {
    const earlier = uuidv7(1_790_000_000_000);
    const later = uuidv7(1_790_000_000_001);

    expect(earlier).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(earlier < later).toBe(true);
    expect(uuidv7()).not.toBe(uuidv7());
  });
});
