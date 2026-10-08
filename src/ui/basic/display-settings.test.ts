import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { parseDeviceChoices } from "@/contracts/deviceChoices";
import { createChoicesStore } from "../choices/choices-store";
import { BASIC_BOOT_SCRIPT, isBasic, isLargeText, saveDisplayChoice } from "./basic-mode";

describe("independent display choices", () => {
  it("changes text without hiding content and preserves that size when simpler view changes", () => {
    let raw: string | null = null;
    const store = createChoicesStore(() => ({ getItem: () => raw, setItem: (_key, value) => { raw = value; }, removeItem: () => { raw = null; } }));
    saveDisplayChoice({ textSize: "large" }, store);
    expect(isLargeText(store.getSnapshot())).toBe(true);
    expect(isBasic(store.getSnapshot())).toBe(false);
    saveDisplayChoice({ basic: true }, store);
    saveDisplayChoice({ textSize: "standard" }, store);
    expect(isBasic(store.getSnapshot())).toBe(true);
    expect(isLargeText(store.getSnapshot())).toBe(false);
    saveDisplayChoice({ basic: false }, store);
    expect(isLargeText(store.getSnapshot())).toBe(false);
    expect(parseDeviceChoices(raw)?.textSize).toBe("standard");
  });
  it("preserves the larger size for existing basic-mode users", () => {
    expect(isLargeText({ v: 1, basic: true })).toBe(true);
    expect(isLargeText({ v: 1, basic: true, textSize: "standard" })).toBe(false);
  });
  it("applies independently saved preferences before first paint and drops invalid sizes", () => {
    const attrs: Record<string,string> = {};
    runInNewContext(BASIC_BOOT_SCRIPT, { localStorage: { getItem: () => JSON.stringify({ v: 1, basic: false, textSize: "large" }) }, document: { documentElement: { setAttribute: (k:string,v:string) => { attrs[k]=v; } } } });
    expect(attrs).toEqual({ "data-text-size": "large" });
    expect(parseDeviceChoices('{"v":1,"textSize":"huge","lang":"en"}')).toEqual({v:1,lang:"en"});
  });
});
