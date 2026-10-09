// Taking the baselines of one failed CI run (scripts/ci/baselines-from-run.mjs): which attempt and which pictures it takes.
import { describe, expect, it } from "vitest";
import { actualsIn, lastAttempts } from "../scripts/ci/baselines-from-run.mjs";

describe("lastAttempts", () => {
  it("takes the last attempt of each test, so a picture that matched on a retry is not taken", () => {
    expect(
      lastAttempts(["home-the-home-page", "home-the-home-page-retry1", "home-the-home-page-retry2", "map-the-map", "map-the-map-retry1"]),
    ).toEqual(["home-the-home-page-retry2", "map-the-map-retry1"]);
  });

  it("takes the only attempt of a test that was not retried (a missing baseline is never retried)", () => {
    expect(lastAttempts(["terms-new-page"])).toEqual(["terms-new-page"]);
  });

  it("orders attempts by number, not by name", () => {
    expect(lastAttempts(["a-retry10", "a-retry9", "a"])).toEqual(["a-retry10"]);
  });
});

describe("actualsIn", () => {
  it("maps each -actual.png to the baseline it replaces and ignores the other files", () => {
    expect(actualsIn(["home-en-390-actual.png", "home-en-390-diff.png", "home-en-390-expected.png", "trace.zip", "map-ur-768-actual.png"])).toEqual({
      take: [
        { actual: "home-en-390-actual.png", baseline: "home-en-390.png" },
        { actual: "map-ur-768-actual.png", baseline: "map-ur-768.png" },
      ],
      unstable: [],
    });
  });

  it("does not take a picture of a page that never held still (Playwright wrote a -previous.png)", () => {
    expect(actualsIn(["home-en-390-actual.png", "home-en-390-previous.png"])).toEqual({ take: [], unstable: ["home-en-390.png"] });
  });
});
