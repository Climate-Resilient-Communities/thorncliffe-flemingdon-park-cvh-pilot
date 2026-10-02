import { describe, expect, it } from "vitest";
import { normaliseAuthenticatorCode } from "./authenticatorCode";

describe("authenticator code", () => {
  it.each([
    ["123456", "123456"],
    ["123 456", "123456"],
    [" 012345 ", "012345"],
  ])("accepts %j as %s", (input, code) => {
    expect(normaliseAuthenticatorCode(input)).toBe(code);
  });

  it.each(["", "12345", "1234567", "12345a", "１２３４５６", "123-456"])("refuses %j", (input) => {
    expect(normaliseAuthenticatorCode(input)).toBeNull();
  });
});
