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
});
