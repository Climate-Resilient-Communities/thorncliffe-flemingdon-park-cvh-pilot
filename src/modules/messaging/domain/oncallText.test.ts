import { describe, expect, it } from "vitest";
import { ONCALL_TEXT_CONDITIONS, renderOncallText } from "./oncallText";
import { looksLikePhoneNumber } from "./phoneNumber";

describe("renderOncallText (AD-21, S06.07)", () => {
  it.each(ONCALL_TEXT_CONDITIONS)("%s is one gsm7 segment, whatever the count, with nothing unfilled and no number", (condition) => {
    for (const count of [0, 1, 12, 1_000_000]) {
      const text = renderOncallText(condition, count);
      expect(text).toMatchObject({ encoding: "gsm7", segments: 1 });
      expect(text.body.startsWith("CVH:")).toBe(true);
      expect(text.body).not.toMatch(/[{}]/);
      expect(looksLikePhoneNumber(text.body)).toBe(false);
    }
  });
});
