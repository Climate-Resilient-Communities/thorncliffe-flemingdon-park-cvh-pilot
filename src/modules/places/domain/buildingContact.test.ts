import { describe, expect, it } from "vitest";
import { checkContact, normalizePhone, telHref } from "./buildingContact";

describe("normalizePhone", () => {
  it.each([
    ["416 555 0123", "416-555-0123"],
    ["(416) 555-0123", "416-555-0123"],
    ["+1 416.555.0123", "416-555-0123"],
    ["1-416-555-0123", "416-555-0123"],
    ["  4165550123 ", "416-555-0123"],
  ])("writes %s as %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "555-0123", "416 555 012", "016 555 0123", "416 155 0123", "416 555 0123 ext 4", "call me", "+44 20 7946 0958", "416 555 01234"])("refuses %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("makes a tel: link with the country code", () => {
    expect(telHref("416-555-0123")).toBe("tel:+14165550123");
  });
});

describe("checkContact", () => {
  it("accepts a role and a number, tidying both", () => {
    expect(checkContact("  Building   superintendent ", "(416) 555-0123")).toEqual({ ok: true, contact: { role: "Building superintendent", phone: "416-555-0123" } });
  });

  it("removes the contact when both are empty", () => {
    expect(checkContact("  ", "")).toEqual({ ok: true, contact: null });
  });

  it("refuses one without the other, with the reason", () => {
    expect(checkContact("Superintendent", " ")).toEqual({ ok: false, error: "role_without_phone" });
    expect(checkContact("", "416 555 0123")).toEqual({ ok: false, error: "phone_without_role" });
  });

  it("refuses a role of more than 40 characters, or with characters it may not have", () => {
    expect(checkContact("x".repeat(41), "416 555 0123")).toEqual({ ok: false, error: "role_too_long" });
    expect(checkContact("x".repeat(40), "416 555 0123")).toMatchObject({ ok: true });
    expect(checkContact("Super <b>", "416 555 0123")).toEqual({ ok: false, error: "role_characters" });
    expect(checkContact("123", "416 555 0123")).toEqual({ ok: false, error: "role_characters" });
  });

  it("refuses a number that is not a North American one", () => {
    expect(checkContact("Superintendent", "555-0123")).toEqual({ ok: false, error: "phone_invalid" });
  });

  it("accepts a role written in another script", () => {
    expect(checkContact("سپرنٹنڈنٹ", "416 555 0123")).toMatchObject({ ok: true });
  });
});
