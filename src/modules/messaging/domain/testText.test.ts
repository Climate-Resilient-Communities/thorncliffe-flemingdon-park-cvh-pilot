import { describe, expect, it } from "vitest";
import { AUDIT_REASON_OF, DUPLICATE_WINDOW_MS, TEST_TEXT_BODY, isAllowlisted, isE164, isRequestId, maskNumber, maskedLabels } from "./testText";

// Obviously fake numbers (the 555-01xx range).
const A = "+14165550101";
const B = "+14165550102";

describe("the first-text spike's rules", () => {
  it("sends one fixed text and treats 5 minutes as a duplicate", () => {
    expect(TEST_TEXT_BODY).toBe("CVH test from production");
    expect(DUPLICATE_WINDOW_MS).toBe(300_000);
  });

  it("accepts E.164 numbers and nothing else", () => {
    for (const ok of [A, "+442071838750", "+18885550100"]) expect(isE164(ok), ok).toBe(true);
    for (const bad of ["4165550101", "+0165550101", "+1 416 555 0101", "+1416", "+14165550101 ", "tel:+14165550101", "", null, undefined, 14165550101]) {
      expect(isE164(bad), String(bad)).toBe(false);
    }
  });

  it("accepts a uuid as a request id", () => {
    expect(isRequestId("01900000-0000-7000-8000-00000000f015")).toBe(true);
    for (const bad of ["", "abc", "01900000000070008000-00000000f015", null, 7]) expect(isRequestId(bad)).toBe(false);
  });

  it("approves only a number that is exactly on the allowlist", () => {
    expect(isAllowlisted([A], A)).toBe(true);
    expect(isAllowlisted([A], B)).toBe(false);
    expect(isAllowlisted([], A)).toBe(false);
    expect(isAllowlisted([A], "+1416555010")).toBe(false);
    expect(isAllowlisted([A], `${A}1`)).toBe(false);
  });

  it("names a number on screen by its last four digits only", () => {
    expect(maskNumber(A)).toBe("+1 ••• ••• 0101");
    expect(maskNumber(A)).not.toContain("416");
    expect(maskNumber("+442071838750")).toBe("+44 ••• ••• 8750");
  });

  it("makes masked labels unique when two numbers end in the same four digits, so the choices can be told apart", () => {
    expect(maskedLabels([A, B])).toEqual(["+1 ••• ••• 0101", "+1 ••• ••• 0102"]);
    expect(maskedLabels([A, "+16475550101", B, "+19055550101"])).toEqual(["+1 ••• ••• 0101", "+1 ••• ••• 0101 (2)", "+1 ••• ••• 0102", "+1 ••• ••• 0101 (3)"]);
    expect(new Set(maskedLabels([A, "+16475550101"])).size).toBe(2);
  });

  it("gives every refusal an audit reason from the audit catalogue's codes", () => {
    expect(AUDIT_REASON_OF).toEqual({
      invalid: "validation",
      not_available: "not_available",
      not_allowlisted: "not_allowlisted",
      duplicate_number: "duplicate",
      duplicate_request: "duplicate",
    });
  });
});
