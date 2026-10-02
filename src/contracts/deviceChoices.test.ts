import { describe, expect, it } from "vitest";
import { DEVICE_CHOICES_KEY, GROUPS, parseDeviceChoices } from "./deviceChoices";

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
    const raw = JSON.stringify({ v: 1, lang: "en", welcomed: true, groups: ["seniors", "checkin"], buildings: ["100"], floors: [floor], removed: { buildings: 1, floors: 0 } });

    expect(parseDeviceChoices(raw)).toEqual(JSON.parse(raw));
  });

  it("lists the four groups of R-26", () => {
    expect(GROUPS).toEqual(["seniors", "newcomers", "families", "checkin"]);
  });

  it.each([
    null,
    undefined,
    "",
    "not json",
    "[]",
    "null",
    '{"v":2}',
    '{"lang":"ur"}',
    '{"v":1,"lang":"xx"}',
    '{"v":"1"}',
    '{"v":1,"buildings":[7]}',
    '{"v":1,"buildings":["12 Main St"]}',
    '{"v":1,"floors":["3"]}',
    '{"v":1,"groups":["pirates"]}',
    '{"v":1,"welcomed":"yes"}',
    '{"v":1,"removed":{"buildings":-1,"floors":0}}',
  ])(
    "treat %j as no choices",
    (raw) => {
      expect(parseDeviceChoices(raw)).toBeNull();
    },
  );
});
