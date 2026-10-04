import { describe, expect, it } from "vitest";
import { LAUNCH_CODES } from "./languages";
import { RESIDENT_TEXT_KEYS, residentText, type ResidentTextName } from "./residentTexts";

describe("the resident texts' catalog strings (AD-9)", () => {
  it("exist, translated, in all 15 launch languages: none falls back to English", () => {
    for (const name of Object.keys(RESIDENT_TEXT_KEYS) as ResidentTextName[]) {
      for (const lang of LAUNCH_CODES) {
        const text = residentText(lang, name);
        expect(text.startsWith("[EN] "), `${name} in ${lang}`).toBe(false);
        expect(text.trim(), `${name} in ${lang}`).not.toBe("");
      }
    }
  });

  it("keep the keywords residents text in English (YES and STOP), in every language", () => {
    for (const lang of LAUNCH_CODES) {
      expect(residentText(lang, "confirmation"), lang).toMatch(/\bYES\b[^]*\bSTOP\b|\bSTOP\b[^]*\bYES\b/u);
    }
  });

  it("has no catalog for a script variant", () => {
    expect(() => residentText("zh-Hant" as never, "confirmation")).toThrow(RangeError);
  });
});
