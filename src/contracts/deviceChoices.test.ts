import { describe, expect, it } from "vitest";
import { DEVICE_CHOICES_KEY, parseDeviceChoices } from "./deviceChoices";

describe("device choices", () => {
  it("live under cvh.choices", () => {
    expect(DEVICE_CHOICES_KEY).toBe("cvh.choices");
  });

  it("parse a valid value and keep fields this story does not know", () => {
    expect(parseDeviceChoices('{"v":1,"lang":"ur","buildings":[1,2]}')).toEqual({ v: 1, lang: "ur", buildings: [1, 2] });
    expect(parseDeviceChoices('{"v":1}')).toEqual({ v: 1 });
  });

  it.each([null, undefined, "", "not json", "[]", "null", '{"v":2}', '{"lang":"ur"}', '{"v":1,"lang":"xx"}', '{"v":"1"}'])(
    "treat %j as no choices",
    (raw) => {
      expect(parseDeviceChoices(raw)).toBeNull();
    },
  );
});
