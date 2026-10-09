import { describe, expect, it } from "vitest";
import { compareAddresses, streetOf } from "./street";

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

describe("the order of addresses (UAT F-7)", () => {
  it("is by street, then by house number as a number, never as text", () => {
    const addresses = ["25 Thorncliffe Park Dr", "200 Gateway Blvd", "10 Thorncliffe Park Dr", "1 Thorncliffe Park Dr", "2 Grandstand Pl", "18 Thorncliffe Park Dr", "85-95 Thorncliffe Park Dr", "100 Gateway Blvd", "Overlea Blvd", "5 Overlea Blvd"];
    expect([...addresses].sort(compareAddresses)).toEqual([
      "100 Gateway Blvd",
      "200 Gateway Blvd",
      "2 Grandstand Pl",
      "5 Overlea Blvd",
      "Overlea Blvd",
      "1 Thorncliffe Park Dr",
      "10 Thorncliffe Park Dr",
      "18 Thorncliffe Park Dr",
      "25 Thorncliffe Park Dr",
      "85-95 Thorncliffe Park Dr",
    ]);
  });

  it("keeps a range at its first number and orders the same number by what follows it", () => {
    expect(["12A Grenoble Dr", "12 Grenoble Dr", "85-95 Grenoble Dr", "9 Grenoble Dr"].sort(compareAddresses)).toEqual(["9 Grenoble Dr", "12 Grenoble Dr", "12A Grenoble Dr", "85-95 Grenoble Dr"]);
  });
});
