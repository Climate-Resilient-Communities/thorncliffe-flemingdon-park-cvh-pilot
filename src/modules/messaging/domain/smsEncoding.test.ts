import { describe, expect, it } from "vitest";
import { NORMALISATION_TABLE, SMS_MAX_BODY_LENGTH, countSms, normaliseSms } from "./smsEncoding";

describe("normaliseSms", () => {
  it("turns curly quotes, dashes, the ellipsis and the degree sign into plain characters, so the text stays GSM-7", () => {
    const pasted = "Power’s out – don’t use the “elevators”… It is 35°C inside — stay cool.";
    const plain = "Power's out - don't use the \"elevators\"... It is 35C inside - stay cool.";

    expect(normaliseSms(pasted)).toBe(plain);
    expect(countSms(pasted).encoding).toBe("ucs2");
    expect(countSms(normaliseSms(pasted)).encoding).toBe("gsm7");
  });

  it.each(Object.entries(NORMALISATION_TABLE))("maps %j to %j", (character, plain) => {
    expect(normaliseSms(`a${character}b`)).toBe(`a${plain}b`);
  });

  it("maps every character of the table to something GSM-7 can carry", () => {
    for (const [character] of Object.entries(NORMALISATION_TABLE)) {
      expect(countSms(normaliseSms(`a${character}b`)).encoding, `U+${character.charCodeAt(0).toString(16)}`).toBe("gsm7");
    }
  });

  it("composes decomposed letters (NFC): e and a combining acute accent is the one GSM-7 letter é", () => {
    const decomposed = "Cafe\u0301";

    expect(normaliseSms(decomposed)).toBe("Café");
    expect(countSms(decomposed).encoding).toBe("ucs2");
    expect(countSms(normaliseSms(decomposed))).toEqual({ encoding: "gsm7", units: 4, segments: 1 });
  });

  it("never changes a letter: accents the GSM-7 alphabet lacks stay, and the body is UCS-2", () => {
    for (const word of ["français", "Slovenčina", "áéíóú", "ñandú", "Ελληνικά", "اردو", "中文"]) {
      expect(normaliseSms(word)).toBe(word);
    }
    expect(countSms("français").encoding).toBe("ucs2");
  });

  it("keeps the joiners and direction marks the Arabic and Indic scripts need, and drops invisible ones that mean nothing", () => {
    const keep = "می\u200Cخواهم \u200Fاردو\u200E क\u094D\u200Dष";

    expect(normaliseSms(keep)).toBe(keep);
    expect(normaliseSms("a\u200Bb\uFEFFc\u00ADd\u2060e")).toBe("abcde");
  });

  it("makes line endings \\n, removes other control characters, trailing spaces and runs of blank lines, and trims", () => {
    expect(normaliseSms("  one\r\ntwo \rthree\u2028four\u0085five\u0007\u0000six\u007F  ")).toBe("one\ntwo\nthree\nfour\nfivesix");
    expect(normaliseSms("a\n\n\n\n\nb")).toBe("a\n\nb");
    expect(normaliseSms("a \t \nb")).toBe("a\nb");
    expect(normaliseSms("\n\n")).toBe("");
  });

  it("is idempotent and gives the same output for the same input", () => {
    const samples = ["Power’s out – “now”…", "Cafe\u0301\r\n\r\n\r\nok", "اردو \u200F مثال", "😀 emoji\t\ttab", ""];
    for (const sample of samples) {
      const once = normaliseSms(sample);
      expect(normaliseSms(once)).toBe(once);
    }
  });

  it("leaves emoji alone (they are UCS-2, two code units each)", () => {
    expect(normaliseSms("Stay safe 😀")).toBe("Stay safe 😀");
    expect(countSms("Stay safe 😀")).toEqual({ encoding: "ucs2", units: 12, segments: 1 });
  });
});

describe("countSms: GSM-7", () => {
  it("is one segment up to 160 septets and parts of 153 after that", () => {
    expect(countSms("a".repeat(160))).toEqual({ encoding: "gsm7", units: 160, segments: 1 });
    expect(countSms("a".repeat(161))).toEqual({ encoding: "gsm7", units: 161, segments: 2 });
    expect(countSms("a".repeat(306))).toEqual({ encoding: "gsm7", units: 306, segments: 2 });
    expect(countSms("a".repeat(307))).toEqual({ encoding: "gsm7", units: 307, segments: 3 });
    expect(countSms("a".repeat(459)).segments).toBe(3);
    expect(countSms("a".repeat(460)).segments).toBe(4);
  });

  it("counts every character of the default alphabet as one septet", () => {
    const alphabet = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

    expect([...alphabet]).toHaveLength(127);
    expect(countSms(alphabet)).toEqual({ encoding: "gsm7", units: 127, segments: 1 });
  });

  it("counts every character of the extension table as two septets", () => {
    for (const character of ["\f", "^", "{", "}", "\\", "[", "~", "]", "|", "€"]) {
      expect(countSms(character), JSON.stringify(character)).toEqual({ encoding: "gsm7", units: 2, segments: 1 });
    }
    // 80 extension characters are exactly 160 septets: one segment; 81 are 162: two.
    expect(countSms("{".repeat(80))).toEqual({ encoding: "gsm7", units: 160, segments: 1 });
    expect(countSms("{".repeat(81))).toEqual({ encoding: "gsm7", units: 162, segments: 2 });
    expect(countSms("a".repeat(158) + "[]")).toEqual({ encoding: "gsm7", units: 162, segments: 2 });
    expect(countSms("a".repeat(156) + "[]")).toEqual({ encoding: "gsm7", units: 160, segments: 1 });
  });

  it("never splits an escape sequence across two parts", () => {
    // 152 septets leave one free in the first part; the two-septet "{" starts the second part.
    const body = "a".repeat(152) + "{" + "a".repeat(305);

    expect(countSms(body)).toEqual({ encoding: "gsm7", units: 459, segments: 4 });
    // The same septets without the extension character are exactly three parts.
    expect(countSms("a".repeat(459)).segments).toBe(3);
  });

  it("is UCS-2 as soon as one character is outside the alphabet and its extension table", () => {
    for (const body of ["Garçon", "naïve", "Ωmega ok but ç", "Stay safe 😀", "日本", "a’b", "`tick`", "100°", "\u001B"]) {
      expect(countSms(body).encoding, body).toBe("ucs2");
    }
    // é è ù ì ò Ç are in the alphabet; ç lower case is not.
    expect(countSms("éèùìòÇ").encoding).toBe("gsm7");
  });

  it("has no segments for an empty body", () => {
    expect(countSms("")).toEqual({ encoding: "gsm7", units: 0, segments: 0 });
  });
});

describe("countSms: UCS-2", () => {
  const urdu = (n: number) => "ا".repeat(n);

  it("is one segment up to 70 code units and parts of 67 after that", () => {
    expect(countSms(urdu(70))).toEqual({ encoding: "ucs2", units: 70, segments: 1 });
    expect(countSms(urdu(71))).toEqual({ encoding: "ucs2", units: 71, segments: 2 });
    expect(countSms(urdu(134))).toEqual({ encoding: "ucs2", units: 134, segments: 2 });
    expect(countSms(urdu(135))).toEqual({ encoding: "ucs2", units: 135, segments: 3 });
    expect(countSms(urdu(201)).segments).toBe(3);
    expect(countSms(urdu(202)).segments).toBe(4);
  });

  it("counts a character outside the Basic Multilingual Plane as two code units, kept whole across parts", () => {
    expect(countSms(`${urdu(68)}😀`)).toEqual({ encoding: "ucs2", units: 70, segments: 1 });
    expect(countSms(`${urdu(69)}😀`)).toEqual({ encoding: "ucs2", units: 71, segments: 2 });
    // 66 units leave one free in the first part: the pair starts the second, and 66 more fill it past 67.
    expect(countSms(`${urdu(66)}😀${urdu(66)}`)).toEqual({ encoding: "ucs2", units: 134, segments: 3 });
  });

  it("counts Latin text with one UCS-2 character at UCS-2 rates", () => {
    const body = "a".repeat(70) + "ç";

    expect(countSms(body)).toEqual({ encoding: "ucs2", units: 71, segments: 2 });
  });
});

describe("SMS_MAX_BODY_LENGTH", () => {
  it("is Twilio's 1600 characters", () => {
    expect(SMS_MAX_BODY_LENGTH).toBe(1600);
  });
});
