import { describe, expect, it } from "vitest";
import { DEVICE_CHOICES_KEY, parseDeviceChoices } from "./deviceChoices";
import { GROUPS } from "./groups";

describe("device choices", () => {
  it("live under cvh.choices", () => {
    expect(DEVICE_CHOICES_KEY).toBe("cvh.choices");
  });

  it("parse a valid value and keep fields this story does not know", () => {
    expect(parseDeviceChoices('{"v":1,"lang":"ur","buildings":["100","200"],"basic":true,"muted":["heat"]}')).toEqual({
      v: 1,
      lang: "ur",
      buildings: ["100", "200"],
      basic: true,
      muted: ["heat"],
    });
    expect(parseDeviceChoices('{"v":1}')).toEqual({ v: 1 });
  });

  it("parse every field this story saves", () => {
    const floor = "0198a000-0000-7000-8000-000000000001";
    const raw = JSON.stringify({ v: 1, lang: "en", welcomed: true, groups: ["seniors", "checkin"], buildings: ["100"], floors: [floor], removed: { buildings: 1, floors: 0 }, savedAt: 1700000000000 });

    expect(parseDeviceChoices(raw)).toEqual(JSON.parse(raw));
  });

  it("lists the four groups of R-26", () => {
    expect(GROUPS).toEqual(["seniors", "newcomers", "families", "checkin"]);
  });

  it.each([null, undefined, "", "not json", "{oops", "[]", "null", "7", '"v"', '{"v":2}', '{"lang":"ur"}', '{"v":"1"}'])(
    "treat %j as no choices: JSON that is not an object of version 1 is a first visit",
    (raw) => {
      expect(parseDeviceChoices(raw)).toBeNull();
    },
  );

  describe("a field of the wrong type", () => {
    it.each([
      ["a language nobody offers", '{"v":1,"lang":"xx","welcomed":true}', { v: 1, welcomed: true }],
      ["a building that is not an rsn", '{"v":1,"lang":"ur","buildings":[7]}', { v: 1, lang: "ur" }],
      ["a building that is an address", '{"v":1,"lang":"ur","buildings":["12 Main St"]}', { v: 1, lang: "ur" }],
      ["a floor that is not an id", '{"v":1,"lang":"ur","floors":["3"]}', { v: 1, lang: "ur" }],
      ["a flag that is not a boolean", '{"v":1,"lang":"ur","welcomed":"yes"}', { v: 1, lang: "ur" }],
      ["a removed count below zero", '{"v":1,"lang":"ur","removed":{"buildings":-1,"floors":0}}', { v: 1, lang: "ur" }],
      ["a savedAt that is not a number", '{"v":1,"lang":"ur","savedAt":"yesterday"}', { v: 1, lang: "ur" }],
      ["a basic flag that is not a boolean (S02.14)", '{"v":1,"lang":"ur","basic":"true"}', { v: 1, lang: "ur" }],
      ["a null field", '{"v":1,"lang":"ur","groups":null}', { v: 1, lang: "ur" }],
    ])("%s is dropped on its own; the language and the rest are kept", (_name, raw, expected) => {
      expect(parseDeviceChoices(raw)).toEqual(expected);
    });

    it("leaves the fields that are fine and the ones it does not know", () => {
      expect(parseDeviceChoices('{"v":1,"lang":"fr","welcomed":true,"buildings":["100",7],"basic":true,"groups":["seniors"]}')).toEqual({
        v: 1,
        lang: "fr",
        welcomed: true,
        basic: true,
        groups: ["seniors"],
      });
    });
  });

  it("filters out a group nobody offers and keeps the others", () => {
    expect(parseDeviceChoices('{"v":1,"lang":"ur","groups":["pirates","seniors","checkin",3]}')).toEqual({ v: 1, lang: "ur", groups: ["seniors", "checkin"] });
    expect(parseDeviceChoices('{"v":1,"groups":["pirates"]}')).toEqual({ v: 1, groups: [] });
  });

  it("reads the value S02.02 saved, {v: 1, lang}, as it is", () => {
    expect(parseDeviceChoices('{"v":1,"lang":"ur"}')).toEqual({ v: 1, lang: "ur" });
  });
});

describe("device choices share the schemas of the rest of the contracts", () => {
  it("keep the same group ids a resident saved (R-26), in the same order", () => {
    expect([...GROUPS]).toEqual(["seniors", "newcomers", "families", "checkin"]);
    expect(parseDeviceChoices('{"v":1,"groups":["checkin","pensioners","seniors"]}')).toEqual({ v: 1, groups: ["checkin", "seniors"] });
  });

  it("keep a stored floor id that is a uuid, of either case, and drop one that is not, as before the schemas were unified", () => {
    const lower = "01900000-0000-7000-8000-00000000abcd";
    const upper = lower.toUpperCase();
    expect(parseDeviceChoices(JSON.stringify({ v: 1, floors: [lower] }))).toEqual({ v: 1, floors: [lower] });
    expect(parseDeviceChoices(JSON.stringify({ v: 1, floors: [upper] }))).toEqual({ v: 1, floors: [upper] });
    expect(parseDeviceChoices(JSON.stringify({ v: 1, lang: "ur", floors: ["G"] }))).toEqual({ v: 1, lang: "ur" });
  });
});
