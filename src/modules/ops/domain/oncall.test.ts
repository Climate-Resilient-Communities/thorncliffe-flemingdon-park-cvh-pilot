import { describe, expect, it } from "vitest";
import { ONCALL_LABEL_MAX_CHARS, parseOncallLabel, parseOncallNumber } from "./oncall";

describe("an on-call number (Canadian +1, as E.164)", () => {
  it.each([
    ["416-555-0123", "+14165550123"],
    ["(416) 555 0123", "+14165550123"],
    ["416.555.0123", "+14165550123"],
    ["4165550123", "+14165550123"],
    ["1 416 555 0123", "+14165550123"],
    ["+1 416 555 0123", "+14165550123"],
    ["+14165550123", "+14165550123"],
    ["  +1 (647) 555-0199 ", "+16475550199"],
  ])("reads %s as %s", (input, expected) => {
    expect(parseOncallNumber(input)).toBe(expected);
  });

  it.each([
    ["too short", "555-0123"],
    ["too long", "416-555-01234"],
    ["an area code that starts with 1", "116-555-0123"],
    ["an exchange that starts with 0", "416-055-0123"],
    ["a plus sign without the country code 1", "+4165550123"],
    ["another country", "+44 20 7946 0958"],
    ["letters", "416-555-CALL"],
    ["an email address", "me@example.org"],
    ["nothing", ""],
    ["a very long string", "4".repeat(100)],
  ])("refuses %s", (_, input) => {
    expect(parseOncallNumber(input)).toBeNull();
  });

  it("refuses what is not a string", () => {
    for (const input of [undefined, null, 4165550123, {}, ["416-555-0123"]]) expect(parseOncallNumber(input)).toBeNull();
  });
});

describe("an on-call label", () => {
  it("is trimmed, with runs of spaces made one", () => {
    expect(parseOncallLabel("  IT   lead ")).toEqual({ ok: true, label: "IT lead" });
  });

  it("has control characters taken out (they become spaces)", () => {
    expect(parseOncallLabel("IT\u0000lead\n")).toEqual({ ok: true, label: "IT lead" });
  });

  it("is refused when empty or not text", () => {
    for (const input of ["", "   ", "\n\t", undefined, null, 4]) expect(parseOncallLabel(input)).toEqual({ ok: false, problem: "label_missing" });
  });

  it("is refused above 40 characters, counted as people count them", () => {
    expect(parseOncallLabel("a".repeat(ONCALL_LABEL_MAX_CHARS))).toEqual({ ok: true, label: "a".repeat(ONCALL_LABEL_MAX_CHARS) });
    expect(parseOncallLabel("a".repeat(ONCALL_LABEL_MAX_CHARS + 1))).toEqual({ ok: false, problem: "label_too_long" });
    expect(parseOncallLabel("é".repeat(ONCALL_LABEL_MAX_CHARS))).toMatchObject({ ok: true });
  });
});
