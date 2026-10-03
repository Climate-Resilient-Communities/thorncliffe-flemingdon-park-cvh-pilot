import { describe, expect, it } from "vitest";
import { toWesternDigits } from "./westernDigits";

describe("toWesternDigits (design note D-13: digits are Western in every language)", () => {
  it.each([
    ["Urdu and Dari (Arabic-Indic)", "٠١٢٣٤٥٦٧٨٩"],
    ["Pashto (Extended Arabic-Indic)", "۰۱۲۳۴۵۶۷۸۹"],
    ["Hindi (Devanagari)", "०१२३४५६७८९"],
    ["Bengali", "০১২৩৪৫৬৭৮৯"],
    ["Punjabi (Gurmukhi)", "੦੧੨੩੪੫੬੭੮੯"],
    ["Gujarati", "૦૧૨૩૪૫૬૭૮૯"],
    ["Tamil", "௦௧௨௩௪௫௬௭௮௯"],
    ["full-width", "０１２３４５６７８９"],
    ["mathematical bold, which follow other sets in one run", "𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗"],
    ["mathematical monospace, the last of five sets", "𝟶𝟷𝟸𝟹𝟺𝟻𝟼𝟽𝟾𝟿"],
  ])("writes %s as 0 to 9", (_script, digits) => {
    expect(toWesternDigits(digits)).toBe("0123456789");
  });

  it("writes a building number, a time and a phone number in each script's digits as 0-9, and leaves the words around them", () => {
    expect(toWesternDigits("لفٹ ۸۵ تھورنکلف، ۱۰:۳۰ بجے، فون ۴۱۶-۵۵۵-۰۱۹۹")).toBe("لفٹ 85 تھورنکلف، 10:30 بجے، فون 416-555-0199");
    expect(toWesternDigits("সকাল ৮৫ নম্বর, ফোন ৯১১")).toBe("সকাল 85 নম্বর, ফোন 911");
    expect(toWesternDigits("இரவு ௮௫ மணி")).toBe("இரவு 85 மணி");
  });

  it("leaves Western digits, other numerals, punctuation and everything that is not a decimal digit as it was", () => {
    const text = "85 Thorncliffe Park Dr, ¼ ², Ⅻ 十二, ٫ ٬ ، ۔ “ ” 🏢 é";
    expect(toWesternDigits(text)).toBe(text);
    expect(toWesternDigits("")).toBe("");
  });

  it("writes the digits of every decimal numbering system the runtime's Intl knows as 0 to 9 (an independent list of scripts' digits)", () => {
    const systems = Intl.supportedValuesOf("numberingSystem");
    let checked = 0;
    for (const system of systems) {
      const format = new Intl.NumberFormat(`en-u-nu-${system}`, { useGrouping: false });
      const digits = [...Array(10).keys()].map((n) => format.format(n)).join("");
      // Some systems are not decimal digits (Chinese numerals, for one): they are not Nd and are not touched.
      if (!/^\p{Nd}{10}$/u.test(digits)) continue;
      checked += 1;
      expect(toWesternDigits(digits), system).toBe("0123456789");
    }
    expect(checked).toBeGreaterThan(40);
  });
});
