import { describe, expect, it } from "vitest";
import { LANG_CODES } from "../../../contracts/lang";
import { DRILL_LABEL_MAX_CHARS, DRILL_ROSTER_MAX, bodyLangOf, parseRosterLabel, parseRosterLang, parseRosterNumber } from "./drillRoster";

describe("a drill roster number (Canadian +1, as E.164)", () => {
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
    expect(parseRosterNumber(input)).toBe(expected);
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
    ["not a string", 4165550123],
    ["a very long string", "4".repeat(100)],
  ])("refuses %s", (_, input) => {
    expect(parseRosterNumber(input)).toBeNull();
  });
});

describe("a drill roster label", () => {
  it("is trimmed, with runs of space made one and a control character made a space", () => {
    expect(parseRosterLabel("  Hub   phone\u0007two ")).toEqual({ ok: true, label: "Hub phone two" });
  });

  it("is refused when it is empty, blank or not a string, and over the limit", () => {
    expect(parseRosterLabel("")).toEqual({ ok: false, problem: "label_missing" });
    expect(parseRosterLabel("   \t ")).toEqual({ ok: false, problem: "label_missing" });
    expect(parseRosterLabel(null)).toEqual({ ok: false, problem: "label_missing" });
    expect(parseRosterLabel("x".repeat(DRILL_LABEL_MAX_CHARS))).toMatchObject({ ok: true });
    expect(parseRosterLabel("x".repeat(DRILL_LABEL_MAX_CHARS + 1))).toEqual({ ok: false, problem: "label_too_long" });
  });
});

describe("a drill roster language", () => {
  it("is one of the language codes, as sent", () => {
    for (const code of LANG_CODES) expect(parseRosterLang(code), code).toBe(code);
    for (const bad of ["", "EN", "english", "xx", null, undefined, 4]) expect(parseRosterLang(bad), String(bad)).toBeNull();
  });

  it("gets the text in its own language where the entry has one, and the English text where it has none", () => {
    expect(bodyLangOf("ur", ["en", "ur", "ps"])).toBe("ur");
    expect(bodyLangOf("zh-Hant", ["en", "ur", "zh"])).toBe("en");
    expect(bodyLangOf("en", ["en"])).toBe("en");
    expect(bodyLangOf("ps", [])).toBe("en");
  });

  it("has a roster limit that bounds the cost of a drill", () => {
    expect(DRILL_ROSTER_MAX).toBe(20);
  });
});
