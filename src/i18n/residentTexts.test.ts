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

  it("keep STOP, the digit 0 and {link} in S07.04's texts in every language (the router reads Western digits; the link is filled in)", () => {
    for (const lang of LAUNCH_CODES) {
      const welcome = residentText(lang, "welcome");
      expect(welcome, lang).toMatch(/\bSTOP\b/u);
      expect(welcome, lang).toContain("0");
      // Replies 1, 2 and 3 get no answer until S07.05's menus, so the welcome does not offer them yet (S07.05 puts them back).
      for (const digit of ["1", "2", "3"]) expect(welcome, `${lang} ${digit}`).not.toContain(digit);
      expect(residentText(lang, "deletePrompt"), lang).toMatch(/0[^]*10|10[^]*0/u);
      expect(residentText(lang, "signupInfo"), lang).toContain("{link}");
      expect(residentText(lang, "signupInfo"), lang).toMatch(/\bSTOP\b/u);
      expect(residentText(lang, "alreadySignedUp"), lang).toContain("CVH");
    }
  });

  it("has no catalog for a script variant", () => {
    expect(() => residentText("zh-Hant" as never, "confirmation")).toThrow(RangeError);
  });
});
