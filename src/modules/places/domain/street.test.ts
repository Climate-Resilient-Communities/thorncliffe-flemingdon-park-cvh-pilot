import { describe, expect, it } from "vitest";
import { streetOf } from "./street";

describe("the street of an address", () => {
  it("is everything after the house number", () => {
    expect(streetOf("85-95 Thorncliffe Park Dr")).toEqual({ number: "85-95", street: "Thorncliffe Park Dr" });
    expect(streetOf("1 Deauville Lane")).toEqual({ number: "1", street: "Deauville Lane" });
    expect(streetOf("2A St Dennis Dr")).toEqual({ number: "2A", street: "St Dennis Dr" });
  });

  it("collapses spaces, and is the whole address when it starts with no number", () => {
    expect(streetOf("  10   Grenoble  Dr ")).toEqual({ number: "10", street: "Grenoble Dr" });
    expect(streetOf("Overlea Blvd")).toEqual({ number: null, street: "Overlea Blvd" });
    expect(streetOf("12")).toEqual({ number: null, street: "12" });
  });
});
