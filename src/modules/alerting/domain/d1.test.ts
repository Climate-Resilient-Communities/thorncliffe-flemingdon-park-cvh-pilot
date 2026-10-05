import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "../../../contracts/staffRoles";
import { ENTRY_KINDS } from "./lifecycle";
import { D1_KINDS, isD1Eligible, type D1Facts } from "./d1";

// The pilot's `disruption_type` rows (db/migrations/20261002250000_alert_lifecycle.sql).
const DIRECT = new Map<string, boolean | null>([
  ["power", true],
  ["water", true],
  ["elevator", true],
  ["flood", true],
  ["fire", false],
  ["other", false],
  ["heat", null],
  ["smoke", null],
  ["winter", null],
]);

const facts = (over: Partial<D1Facts> = {}): D1Facts => ({ authorRole: "ambassador", isDrill: false, kind: "update", types: ["power"], direct: DIRECT, ...over });

describe("isD1Eligible (S08.03, AD-5)", () => {
  describe("by type", () => {
    it.each([
      ["power", true],
      ["water", true],
      ["elevator", true],
      ["flood", true],
      ["fire", false],
      ["other", false],
      ["heat", false],
      ["smoke", false],
      ["winter", false],
      ["unheard-of", false],
    ])("a post of %s is eligible: %s", (type, eligible) => {
      expect(isD1Eligible(facts({ types: [type] }))).toBe(eligible);
    });
  });

  describe("mixed types: every type must be direct", () => {
    it.each([
      [["power", "water"], true],
      [["power", "elevator", "flood"], true],
      [["power", "fire"], false],
      [["fire", "power"], false],
      [["water", "other"], false],
      [["power", "heat"], false],
      [["power", "unheard-of"], false],
      [[], false],
    ])("%j is eligible: %s", (types, eligible) => {
      expect(isD1Eligible(facts({ types }))).toBe(eligible);
    });
  });

  it("counts a null direct as false, and a missing one as false", () => {
    expect(isD1Eligible(facts({ types: ["heat"] }))).toBe(false);
    expect(isD1Eligible(facts({ types: ["power", "heat"] }))).toBe(false);
    expect(isD1Eligible(facts({ types: ["power"], direct: new Map() }))).toBe(false);
    expect(isD1Eligible(facts({ types: ["power"], direct: {} }))).toBe(false);
    expect(isD1Eligible(facts({ types: ["power"], direct: { power: undefined } }))).toBe(false);
    expect(isD1Eligible(facts({ types: ["power"], direct: { power: null } }))).toBe(false);
    expect(isD1Eligible(facts({ types: ["power"], direct: { power: true } }))).toBe(true);
  });

  describe("by kind", () => {
    it.each(ENTRY_KINDS.map((kind) => [kind, (D1_KINDS as readonly string[]).includes(kind)] as const))("a %s is eligible: %s", (kind, eligible) => {
      expect(isD1Eligible(facts({ kind }))).toBe(eligible);
    });

    it("is exactly ack, update and correction", () => {
      expect(ENTRY_KINDS.filter((kind) => isD1Eligible(facts({ kind })))).toEqual(["ack", "update", "correction"]);
    });
  });

  describe("by author role", () => {
    it.each(STAFF_ROLES.map((role) => [role, role === "ambassador"] as const))("a %s's post is eligible: %s", (authorRole, eligible) => {
      expect(isD1Eligible(facts({ authorRole }))).toBe(eligible);
    });
  });

  it("is never eligible in a drill", () => {
    expect(isD1Eligible(facts({ isDrill: true }))).toBe(false);
    expect(isD1Eligible(facts({ isDrill: false }))).toBe(true);
  });

  it("needs every condition at once", () => {
    for (const over of [{ authorRole: "coordinator" }, { isDrill: true }, { kind: "final" }, { kind: "withdrawal" }, { types: ["fire"] }, { types: ["other"] }] as const) {
      expect(isD1Eligible(facts(over))).toBe(false);
    }
    expect(isD1Eligible(facts())).toBe(true);
  });
});
