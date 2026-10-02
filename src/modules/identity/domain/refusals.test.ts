import { describe, expect, it } from "vitest";
import { englishText } from "../../../i18n/text";
import { REFUSAL_MESSAGE_KEYS } from "./refusals";

describe("refusal messages", () => {
  it("has an English catalog string for every refusal", () => {
    for (const [code, key] of Object.entries(REFUSAL_MESSAGE_KEYS)) {
      expect(englishText(key), code).not.toMatch(/^\[EN\]|^staff\./);
    }
  });

  it("refuses during bootstrap with the agreed wording", () => {
    expect(englishText(REFUSAL_MESSAGE_KEYS.bootstrap_incomplete)).toBe("Finish setting up two Admins first");
  });

  it("explains a name that cannot make a starting password", () => {
    expect(englishText(REFUSAL_MESSAGE_KEYS.starting_password_empty)).toMatch(/Latin letters/);
  });

  it("tells the Admin to shorten the name for a starting password over 72 characters", () => {
    expect(englishText(REFUSAL_MESSAGE_KEYS.starting_password_too_long)).toMatch(/72 characters.*Shorten the name used for the password/);
  });

  it("names the letter problem, and does not offer a retry when Supabase rejects the starting password", () => {
    expect(englishText(REFUSAL_MESSAGE_KEYS.starting_password_unsupported_letter)).toMatch(/Latin letters/);
    const rejected = englishText(REFUSAL_MESSAGE_KEYS.provider_rejected);
    expect(rejected).toBe("Supabase rejected the starting password; check the project's password policy.");
    expect(rejected).not.toMatch(/try again/i);
  });
});
