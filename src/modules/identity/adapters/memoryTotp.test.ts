// The fake's TOTP against the published test vectors (RFC 6238 appendix B, SHA-1; RFC 4226 appendix D).
import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hotp, memoryTotpSecret, totpAt, totpCode, totpMatches } from "./memoryTotp";

const RFC_KEY = Buffer.from("12345678901234567890", "ascii");

describe("TOTP for the identity fake", () => {
  it.each([
    [59, "94287082"],
    [1_111_111_109, "07081804"],
    [1_111_111_111, "14050471"],
    [1_234_567_890, "89005924"],
    [2_000_000_000, "69279037"],
    [20_000_000_000, "65353130"],
  ])("gives RFC 6238's SHA-1 value at T = %i s", (seconds, code) => {
    expect(totpAt(RFC_KEY, seconds * 1000, 8)).toBe(code);
  });

  it("gives RFC 4226's HOTP values", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((counter) => hotp(RFC_KEY, counter))).toEqual([
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ]);
  });

  it("reads and writes base32 secrets (RFC 4648)", () => {
    expect(base32Encode(RFC_KEY)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezdgnbvgy3tqojq gezdgnbvgy3tqojq").equals(RFC_KEY)).toBe(true);
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(() => base32Decode("not base32!")).toThrow();
  });

  it("accepts the code of this step and one step either side, and nothing further", () => {
    const secret = memoryTotpSecret("a-user");
    const at = 1_790_000_015_000;
    expect(totpMatches(secret, totpCode(secret, at), at)).toBe(true);
    expect(totpMatches(secret, totpCode(secret, at - 30_000), at)).toBe(true);
    expect(totpMatches(secret, totpCode(secret, at + 30_000), at)).toBe(true);
    expect(totpMatches(secret, totpCode(secret, at - 90_000), at)).toBe(false);
  });

  it("gives each user their own deterministic secret", () => {
    expect(memoryTotpSecret("a-user")).toBe(memoryTotpSecret("a-user"));
    expect(memoryTotpSecret("a-user")).not.toBe(memoryTotpSecret("another-user"));
    expect(memoryTotpSecret("a-user")).toMatch(/^[A-Z2-7]{32}$/);
  });
});
