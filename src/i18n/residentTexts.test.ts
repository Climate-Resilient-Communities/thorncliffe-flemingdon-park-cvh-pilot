import { describe, expect, it } from "vitest";
import { toAsciiDigits } from "../contracts/digits";
import { LAUNCH_CODES } from "./languages";
import { RESIDENT_TEXT_KEYS, residentText, smsDateWords, type ResidentTextName } from "./residentTexts";

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

  it("keep STOP, the digits 0 to 3 and {link} in S07.04's texts in every language (the router reads Western digits; the link is filled in)", () => {
    for (const lang of LAUNCH_CODES) {
      const welcome = residentText(lang, "welcome");
      expect(welcome, lang).toMatch(/\bSTOP\b/u);
      // S07.05's menus answer replies 1, 2 and 3, so the welcome offers them again, with 0.
      for (const digit of ["0", "1", "2", "3"]) expect(welcome, `${lang} ${digit}`).toContain(digit);
      expect(residentText(lang, "deletePrompt"), lang).toMatch(/0[^]*10|10[^]*0/u);
      expect(residentText(lang, "signupInfo"), lang).toContain("{link}");
      expect(residentText(lang, "signupInfo"), lang).toMatch(/\bSTOP\b/u);
      expect(residentText(lang, "alreadySignedUp"), lang).toContain("CVH");
    }
  });

  it("write a date with the catalog's own words in all 15 languages (S09.07): twelve translated months, the day and the month once each, ten numerals", () => {
    for (const lang of LAUNCH_CODES) {
      const words = smsDateWords(lang);
      expect(words.months, lang).toHaveLength(12);
      expect(new Set(words.months).size, lang).toBe(12);
      expect(words.dayMonth, lang).toMatch(/\{day\}/u);
      expect(words.dayMonth, lang).toMatch(/\{month\}/u);
      expect(words.digits, lang).toHaveLength(10);
      // Each is the numeral of its value in one script (what the router reads as that digit).
      for (const [value, numeral] of words.digits.entries()) expect(toAsciiDigits(numeral), `${lang} ${value}`).toBe(String(value));
    }
    expect(smsDateWords("en")).toEqual({ months: expect.arrayContaining(["January", "December"]), dayMonth: "{month} {day}", digits: [..."0123456789"] });
    expect(smsDateWords("bn").digits.join("")).toBe("০১২৩৪৫৬৭৮৯");
  });

  it("keep the reserved digits, the counts and the {placeholders} of S07.05's menu texts in every language", () => {
    for (const lang of LAUNCH_CODES) {
      const has = (name: Parameters<typeof residentText>[1], ...parts: string[]) => {
        for (const part of parts) expect(residentText(lang, name), `${name} in ${lang}: ${part}`).toContain(part);
      };
      has("menuNav", "0", "9");
      has("menuNavMore", "0", "8", "9");
      has("menuWarn", "{n}", "1", "0");
      has("menuHub", "{hub}");
      has("menuReset", "10");
      has("menuLimit", "5", "{hub}");
      has("menuLimitLink", "5", "1", "{hub}");
      has("buildingSaved", "{building}", "{floor}");
      has("buildingSavedWhole", "{building}");
      expect(residentText(lang, "menuNav"), lang).not.toContain("8");
      expect(residentText(lang, "languageSaved"), lang).not.toMatch(/\{\w+\}/u);
    }
  });

  it("fills the {placeholders} it is given values for and leaves the others as written", () => {
    expect(residentText("en", "buildingSaved", { building: "12 Menu Street", floor: "G" })).toBe("Saved. Your building is now 12 Menu Street, floor G.");
    expect(residentText("en", "buildingSaved", { building: "12 Menu Street" })).toBe("Saved. Your building is now 12 Menu Street, floor {floor}.");
    expect(residentText("en", "menuHub")).toBe("Call the Hub at {hub}.");
  });

  it("has no catalog for a script variant", () => {
    expect(() => residentText("zh-Hant" as never, "confirmation")).toThrow(RangeError);
    expect(() => smsDateWords("zh-Hant" as never)).toThrow(RangeError);
  });
});
