import { describe, expect, it } from "vitest";
import { ALERT_TEXT_MAX, VALID_UNTIL_MAX_MS, audienceBuildings, contentRefusal, isWideContent, sameContent, stableJson, validUntilRefusal, type EntryContent } from "./content";

const content = (over: Partial<EntryContent> = {}): EntryContent => ({
  text: "Power is out.",
  types: ["power"],
  audience: { scope: "buildings", buildings: [{ rsn: "4154146", floors: null }] },
  phase: "problem",
  validUntil: new Date("2026-10-02T15:00:00Z"),
  ...over,
});

describe("contentRefusal", () => {
  it("passes valid content, including text of exactly the limit", () => {
    expect(contentRefusal(content())).toBeNull();
    expect(contentRefusal(content({ text: "x".repeat(ALERT_TEXT_MAX) }))).toBeNull();
  });

  it.each([
    ["blank text", { text: " \n " }, "TEXT_EMPTY"],
    ["text over the limit", { text: "x".repeat(ALERT_TEXT_MAX + 1) }, "TEXT_TOO_LONG"],
    ["no type", { types: [] }, "TYPES_EMPTY"],
    ["a repeated type", { types: ["power", "power"] }, "TYPES_REPEATED"],
    ["an unknown phase", { phase: "later" as never }, "PHASE_INVALID"],
    ["an audience without a scope", { audience: {} as never }, "AUDIENCE_INVALID"],
    ["buildings without a list", { audience: { scope: "buildings" } }, "AUDIENCE_INVALID"],
    ["an empty buildings list", { audience: { scope: "buildings", buildings: [] } }, "AUDIENCE_INVALID"],
    ["a building without an rsn", { audience: { scope: "buildings", buildings: [{ floors: null }] } }, "AUDIENCE_INVALID"],
    ["a heat alert for buildings", { types: ["heat"] }, "NEIGHBOURHOOD_ONLY_TYPE"],
    ["smoke with another type for buildings", { types: ["power", "smoke"] }, "NEIGHBOURHOOD_ONLY_TYPE"],
    ["winter for buildings", { types: ["winter"] }, "NEIGHBOURHOOD_ONLY_TYPE"],
    ["an invalid date", { validUntil: new Date("nope") }, "VALID_UNTIL_INVALID"],
  ] as const)("refuses %s", (_, over, refusal) => {
    expect(contentRefusal(content(over as Partial<EntryContent>))).toBe(refusal);
  });

  it("allows the neighbourhood-only types for a neighbourhood audience", () => {
    expect(contentRefusal(content({ types: ["heat", "smoke", "winter"], audience: { scope: "neighbourhood", neighbourhood_ids: ["TP"] } }))).toBeNull();
  });
});

describe("audience helpers", () => {
  it("lists the distinct buildings of a buildings audience, none for a neighbourhood, null for a malformed one", () => {
    expect(audienceBuildings({ scope: "buildings", buildings: [{ rsn: "1" }, { rsn: "2" }, { rsn: "1" }] })).toEqual(["1", "2"]);
    expect(audienceBuildings({ scope: "neighbourhood" })).toEqual([]);
    expect(audienceBuildings({ scope: "buildings", buildings: [{ rsn: "12345678901" }] })).toBeNull();
    expect(audienceBuildings({ scope: "buildings", buildings: "x" })).toBeNull();
  });

  it("calls content wide for a neighbourhood audience or a neighbourhood-only type", () => {
    expect(isWideContent(content())).toBe(false);
    expect(isWideContent(content({ audience: { scope: "neighbourhood" } }))).toBe(true);
    expect(isWideContent(content({ types: ["heat"] }))).toBe(true);
  });
});

describe("sameContent", () => {
  it("compares every field, types without regard to order and audiences without regard to key order", () => {
    expect(sameContent(content({ types: ["power", "water"] }), content({ types: ["water", "power"] }))).toBe(true);
    expect(sameContent(content({ audience: { scope: "buildings", buildings: [{ rsn: "1", floors: null }] } }), content({ audience: { buildings: [{ floors: null, rsn: "1" }], scope: "buildings" } }))).toBe(true);
    expect(sameContent(content(), content({ text: "Other." }))).toBe(false);
    expect(sameContent(content(), content({ phase: "in_progress" }))).toBe(false);
    expect(sameContent(content(), content({ validUntil: new Date("2026-10-02T15:00:01Z") }))).toBe(false);
    expect(sameContent(content(), content({ types: ["power", "water"] }))).toBe(false);
    expect(sameContent(content(), content({ audience: { scope: "neighbourhood" } }))).toBe(false);
  });

  it("writes JSON with sorted keys", () => {
    expect(stableJson({ b: 1, a: [{ d: 2, c: null }] })).toBe('{"a":[{"c":null,"d":2}],"b":1}');
  });
});

describe("validUntilRefusal", () => {
  const NOW = new Date("2026-10-01T15:00:00Z");
  it("requires a time ahead, at most 7 days", () => {
    expect(validUntilRefusal(NOW, NOW)).toBe("VALID_UNTIL_PAST");
    expect(validUntilRefusal(new Date(NOW.getTime() - 1000), NOW)).toBe("VALID_UNTIL_PAST");
    expect(validUntilRefusal(new Date(NOW.getTime() + 1), NOW)).toBeNull();
    expect(validUntilRefusal(new Date(NOW.getTime() + VALID_UNTIL_MAX_MS), NOW)).toBeNull();
    expect(validUntilRefusal(new Date(NOW.getTime() + VALID_UNTIL_MAX_MS + 1), NOW)).toBe("VALID_UNTIL_TOO_FAR");
  });
});
