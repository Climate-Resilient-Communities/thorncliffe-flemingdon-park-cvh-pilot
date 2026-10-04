import { describe, expect, it } from "vitest";
import { markerApplies } from "./kept-state";

describe("markerApplies: the kept-at marker speaks only for the document it was written into", () => {
  it("applies on the path the app was loaded at while no signal has come back", () => {
    expect(markerApplies({ pathname: "/en", loadedPath: "/en", signalBack: false })).toBe(true);
  });

  it("does not apply after a client-side move to another page (the head's marker stays, the page is the server's)", () => {
    expect(markerApplies({ pathname: "/en/alerts/kbcdfghj", loadedPath: "/en", signalBack: false })).toBe(false);
  });

  it("does not apply once signal has come back", () => {
    expect(markerApplies({ pathname: "/en", loadedPath: "/en", signalBack: true })).toBe(false);
  });
});
