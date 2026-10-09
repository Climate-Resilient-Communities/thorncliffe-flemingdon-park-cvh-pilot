import { describe, expect, it } from "vitest";
import { directionsHref } from "./provider-side";

describe("directionsHref", () => {
  it("asks for directions to the place's coordinates, with nothing about the resident in it", () => {
    expect(directionsHref(43.7053, -79.3467)).toBe("https://www.google.com/maps/dir/?api=1&destination=43.7053%2C-79.3467");
  });
});
