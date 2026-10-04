import { describe, expect, it } from "vitest";
import { markUntranslated, parseUntranslatedKeys, untranslatedKeys, UNTRANSLATED_KEYS_VARIABLE } from "./untranslated";

const english = { R31: { title: "Numbers I might need", lead: "Each number is listed by what it is for." }, list: ["a"] };
const urdu = { R31: { title: "نمبر", lead: "ہر نمبر" }, x01: { text: "CVH" } };

describe("untranslatedKeys", () => {
  const local = { [UNTRANSLATED_KEYS_VARIABLE]: "R31.title, R31.lead" };

  it("reads the keys in a local process serving requests", () => {
    expect(untranslatedKeys(local)).toEqual(["R31.title", "R31.lead"]);
    expect(untranslatedKeys({})).toEqual([]);
    expect(untranslatedKeys({ [UNTRANSLATED_KEYS_VARIABLE]: " " })).toEqual([]);
  });

  it("is ignored on Vercel, whatever its environment, and while next build prerenders pages", () => {
    for (const extra of [{ VERCEL: "1" }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, { NEXT_PHASE: "phase-production-build" }]) {
      expect(untranslatedKeys({ ...local, ...extra }), JSON.stringify(extra)).toEqual([]);
    }
  });

  it("throws on a value that does not name catalog keys", () => {
    expect(() => untranslatedKeys({ [UNTRANSLATED_KEYS_VARIABLE]: "R31.title,R31" })).toThrow(/"R31" is not a catalog key/);
    expect(parseUntranslatedKeys("a.b, c.d.e").keys).toEqual(["a.b", "c.d.e"]);
  });
});

describe("markUntranslated", () => {
  it("shows the named keys as English behind the marker, in a copy, and leaves the rest", () => {
    const before = structuredClone(urdu);
    const marked = markUntranslated(urdu, english, ["R31.title"]);
    expect(marked).toEqual({ R31: { title: "[EN] Numbers I might need", lead: "ہر نمبر" }, x01: { text: "CVH" } });
    expect(urdu).toEqual(before);
  });

  it("returns the catalog itself when no key is named", () => {
    expect(markUntranslated(urdu, english, [])).toBe(urdu);
  });

  it("throws on a key English has no string for, so the seam never quietly does nothing", () => {
    expect(() => markUntranslated(urdu, english, ["R31.missing"])).toThrow("English has no string R31.missing");
    expect(() => markUntranslated(urdu, english, ["list.0"])).toThrow("English has no string list.0");
    expect(() => markUntranslated(urdu, english, ["R31"])).toThrow("English has no string R31");
  });
});
