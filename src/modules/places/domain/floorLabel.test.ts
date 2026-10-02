import { describe, expect, it } from "vitest";
import { FLOOR_LABEL_MAX_LENGTH, checkFloorLabel, floorLabelKey, trimFloorLabel } from "./floorLabel";

describe("floor labels", () => {
  it.each(["1", "G", "L", "P1", "14", "Mezz", "1-2", "P 1", "12345678", "a-b c-d"])("accepts %j", (label) => {
    expect(checkFloorLabel(label, [])).toEqual({ ok: true, label });
  });

  it("drops spaces at either end and stores the trimmed label", () => {
    expect(checkFloorLabel("  G ", [])).toEqual({ ok: true, label: "G" });
    expect(trimFloorLabel("\t 12 ")).toBe("12");
  });

  it("refuses an empty label, including one of only spaces", () => {
    expect(checkFloorLabel("", [])).toEqual({ ok: false, error: "label_empty" });
    expect(checkFloorLabel("    ", [])).toEqual({ ok: false, error: "label_empty" });
  });

  it("refuses a label longer than 8 characters, counting after the ends are trimmed", () => {
    expect(FLOOR_LABEL_MAX_LENGTH).toBe(8);
    expect(checkFloorLabel("123456789", [])).toEqual({ ok: false, error: "label_too_long" });
    expect(checkFloorLabel("  12345678  ", [])).toEqual({ ok: true, label: "12345678" });
    expect(checkFloorLabel("1234 5678", [])).toEqual({ ok: false, error: "label_too_long" });
  });

  it.each(["1.5", "P1!", "G/F", "1_2", "Étage", "13 A", "1\t2", "<b>", "１２", "1,2", "L#"])("refuses the characters of %j", (label) => {
    expect(checkFloorLabel(label, [])).toEqual({ ok: false, error: "label_characters" });
  });

  it("refuses a label the building already has, ignoring case and spaces", () => {
    const others = ["1", "G", "P 1", "2-3"];
    expect(checkFloorLabel("g", others)).toEqual({ ok: false, error: "label_duplicate" });
    expect(checkFloorLabel("P1", others)).toEqual({ ok: false, error: "label_duplicate" });
    expect(checkFloorLabel("p  1", others)).toEqual({ ok: false, error: "label_duplicate" });
    expect(checkFloorLabel(" 1 ", others)).toEqual({ ok: false, error: "label_duplicate" });
  });

  it("counts a hyphen: 2-3 and 23 are different labels", () => {
    expect(checkFloorLabel("23", ["2-3"])).toEqual({ ok: true, label: "23" });
    expect(floorLabelKey("2-3")).toBe("2-3");
  });

  it("checks the rules in the order empty, too long, characters, duplicate", () => {
    expect(checkFloorLabel("1.5.1.5.1.5", ["1"])).toEqual({ ok: false, error: "label_too_long" });
    expect(checkFloorLabel("1.5", ["1.5"])).toEqual({ ok: false, error: "label_characters" });
  });

  it("makes the key lower case with no spaces", () => {
    expect(floorLabelKey("P 1")).toBe("p1");
    expect(floorLabelKey("Mezz")).toBe("mezz");
  });
});
