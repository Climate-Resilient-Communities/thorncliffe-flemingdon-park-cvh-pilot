import { describe, expect, it } from "vitest";
import { LANG_CODES } from "./lang";
import { USAGE_BODY_MAX_BYTES, USAGE_EVENTS, UsageEventSchema } from "./usage";

describe("UsageEventSchema (S02.15)", () => {
  it("accepts each event in each language, with or without one of the two neighbourhoods", () => {
    for (const evt of USAGE_EVENTS) {
      for (const lang of LANG_CODES) {
        expect(UsageEventSchema.safeParse({ evt, lang }).success, `${evt} ${lang}`).toBe(true);
        for (const nbhd of ["TP", "FP"]) expect(UsageEventSchema.safeParse({ evt, lang, nbhd }).success, `${evt} ${lang} ${nbhd}`).toBe(true);
      }
    }
  });

  it("names exactly the six events of the story", () => {
    expect([...USAGE_EVENTS]).toEqual(["install", "directory_view", "listing_view", "map_view", "guide_view", "numbers_view"]);
  });

  it("refuses an unknown event, language or neighbourhood, and a missing event or language", () => {
    for (const bad of [
      { evt: "page_view", lang: "en" },
      { evt: "install", lang: "xx" },
      { evt: "install", lang: "EN" },
      { evt: "install", lang: "en", nbhd: "XX" },
      { evt: "install", lang: "en", nbhd: "" },
      { evt: "install", lang: "en", nbhd: null },
      { lang: "en" },
      { evt: "install" },
      "install",
      null,
      [],
    ]) {
      expect(UsageEventSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses any extra field, so nothing that identifies a phone or a place can ride along", () => {
    for (const extra of ["building", "rsn", "floor", "group", "groups", "device", "deviceId", "session", "sessionId", "id", "ts", "at", "ua", "ip", "choices"]) {
      expect(UsageEventSchema.safeParse({ evt: "install", lang: "en", [extra]: "x" }).success, extra).toBe(false);
    }
  });

  it("has a body limit that fits the largest valid event with room, and nothing like a saved list", () => {
    const largest = JSON.stringify({ evt: "directory_view", lang: "zh-Hant", nbhd: "TP" });
    expect(new TextEncoder().encode(largest).byteLength).toBeLessThan(USAGE_BODY_MAX_BYTES / 2);
    expect(USAGE_BODY_MAX_BYTES).toBe(256);
  });
});
