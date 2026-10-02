import { describe, expect, it } from "vitest";
import { AudienceSchema } from "./audience";
import { FloorIdSchema, RsnSchema } from "./places";

describe("the floor id and rsn schemas every contract shares", () => {
  it("a floor is named by a uuid, a building by its register number", () => {
    expect(FloorIdSchema.safeParse("01900000-0000-7000-8000-000000000001").success).toBe(true);
    expect(FloorIdSchema.safeParse("G").success).toBe(false);
    expect(FloorIdSchema.safeParse("4").success).toBe(false);
    expect(RsnSchema.safeParse("4154146").success).toBe(true);
    expect(RsnSchema.safeParse("").success).toBe(false);
    expect(RsnSchema.safeParse("12 Main St").success).toBe(false);
    expect(RsnSchema.safeParse("1234567890").success).toBe(false);
  });

  it("the audience accepts exactly those: a label or a number is not a floor, an address is not a building", () => {
    const audience = (rsn: string, floors: string[] | null) => ({ scope: "buildings", buildings: [{ rsn, floors }], groups: [], types: ["power"] });
    expect(AudienceSchema.safeParse(audience("4154146", ["01900000-0000-7000-8000-000000000001"])).success).toBe(true);
    expect(AudienceSchema.safeParse(audience("4154146", ["3"])).success).toBe(false);
    expect(AudienceSchema.safeParse(audience("4 Milepost Pl", null)).success).toBe(false);
  });
});
