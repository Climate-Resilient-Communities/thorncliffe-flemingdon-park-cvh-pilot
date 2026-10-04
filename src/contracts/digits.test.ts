import { describe, expect, it } from "vitest";
import { toAsciiDigits } from "./digits";

describe("toAsciiDigits", () => {
  it("writes the digits of every script residents type as 0-9", () => {
    const scripts: [string, string][] = [
      ["Extended Arabic-Indic (Urdu, Pashto, Dari)", "۰۱۲۳۴۵۶۷۸۹"],
      ["Arabic-Indic", "٠١٢٣٤٥٦٧٨٩"],
      ["Bengali", "০১২৩৪৫৬৭৮৯"],
      ["Devanagari (Hindi)", "०१२३४५६७८९"],
      ["Gujarati", "૦૧૨૩૪૫૬૭૮૯"],
      ["Gurmukhi (Punjabi)", "੦੧੨੩੪੫੬੭੮੯"],
      ["Tamil", "௦௧௨௩௪௫௬௭௮௯"],
      ["full-width", "０１２３４５６７８９"],
      ["mathematical bold (a run of ten next to other runs)", "𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗"],
      ["mathematical monospace (the last of five runs side by side)", "𝟶𝟷𝟸𝟹𝟺𝟻𝟼𝟽𝟾𝟿"],
    ];
    for (const [name, digits] of scripts) expect(toAsciiDigits(digits), name).toBe("0123456789");
  });

  it("leaves everything that is not a decimal digit as it is", () => {
    expect(toAsciiDigits("(416) 555-0123")).toBe("(416) 555-0123");
    expect(toAsciiDigits("ہاں YES ½ ² Ⅻ")).toBe("ہاں YES ½ ² Ⅻ");
    expect(toAsciiDigits("")).toBe("");
  });
});
