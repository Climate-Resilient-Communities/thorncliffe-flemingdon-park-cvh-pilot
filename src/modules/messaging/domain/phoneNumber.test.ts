import { describe, expect, it } from "vitest";
import { isE164, looksLikePhoneNumber, maskForLog, maskNumber, maskPhoneNumbers } from "./phoneNumber";

// Obviously fake numbers (the 555-01xx range).
const A = "+14165550101";

describe("E.164", () => {
  it("accepts E.164 numbers and nothing else", () => {
    for (const ok of [A, "+442071838750", "+18885550100"]) expect(isE164(ok), ok).toBe(true);
    for (const bad of ["4165550101", "+0165550101", "+1 416 555 0101", "+1416", "+14165550101 ", "tel:+14165550101", "", null, undefined, 14165550101]) {
      expect(isE164(bad), String(bad)).toBe(false);
    }
  });
});

describe("masking a number for a log line", () => {
  it("shows only the last two digits", () => {
    expect(maskForLog(A)).toBe("+*********01");
    expect(maskForLog("+442071838750")).toBe("+**********50");
    expect(maskForLog("(416) 555-0101")).toBe("(***) ***-**01");
    expect(maskForLog("416.555.0123")).toBe("***.***.**23");
    expect(maskForLog(A)).not.toContain("416");
    expect(maskForLog("7")).toBe("7");
    expect(maskForLog("")).toBe("");
  });

  it("masks every phone-number-like part of a text and leaves ids and other numbers alone", () => {
    expect(maskPhoneNumbers(`call ${A} now`)).toBe("call +*********01 now");
    expect(maskPhoneNumbers("rejected 416-555-0101 and (647) 555 0102.")).toBe("rejected ***-***-**01 and (***) *** **02.");
    expect(maskPhoneNumbers("to=+1 416 555 0101;")).toBe("to=+* *** *** **01;");
    expect(maskPhoneNumbers("4165550101")).toBe("********01");
    // A UUID, a Twilio SID, a delivery key, a timestamp in milliseconds, a count and an HTTP status are not numbers.
    for (const text of [
      "01900000-0000-7000-8000-0000000a0001",
      "SM0123456789abcdef0123456789abcdef",
      "transactional:01900000-0000-7000-8000-0000000a0001:menu_reply:abc",
      "1759500000000",
      "segments 3, status 429, 400 recipients, code 30032",
      "2026-10-03T15:00:00Z",
    ]) {
      expect(maskPhoneNumbers(text), text).toBe(text);
    }
  });

  it("recognises a whole string that reads as a phone number", () => {
    for (const phone of [A, "416-555-0101", "(416) 555-0101", "4165550101", "+44 20 7183 8750"]) expect(looksLikePhoneNumber(phone), phone).toBe(true);
    for (const other of ["menu_reply", "01900000-0000-7000-8000-0000000a0001", "abc123", "12345", "n1", "20261003", "123456789012345678"]) {
      // "20261003" has eight digits and reads as a number: a key part like it is refused (a date is not an id here).
      expect(looksLikePhoneNumber(other), other).toBe(other === "20261003");
    }
  });
});

describe("a number named on a Hub screen", () => {
  it("shows its last four digits only", () => {
    expect(maskNumber(A)).toBe("+1 ••• ••• 0101");
    expect(maskNumber(A)).not.toContain("416");
    expect(maskNumber("+442071838750")).toBe("+44 ••• ••• 8750");
  });
});
