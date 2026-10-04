import { describe, expect, it } from "vitest";
import { countSms, looksLikePhoneNumber, maskPhoneNumbers } from "../../messaging";
import { HEALTH_CONDITIONS } from "../domain/events";
import { oncallText } from "./healthJob";

describe("the text to the on-call Admins (S06.07, S09.01)", () => {
  it.each(HEALTH_CONDITIONS)("for %s is one text message segment in the basic alphabet, with the count and no personal data", (condition) => {
    for (const count of [1, 12, 1_000_000]) {
      const body = oncallText(condition, count);
      expect(body.startsWith("CVH:")).toBe(true);
      expect(countSms(body)).toMatchObject({ encoding: "gsm7", segments: 1 });
      // Nothing in it reads as a phone number, and masking finds nothing to mask.
      expect(maskPhoneNumbers(body)).toBe(body);
      expect(looksLikePhoneNumber(body)).toBe(false);
      expect(body).not.toMatch(/\{|\}/);
    }
  });

  it("names the count where the condition counts something, and Smart Encoding with no count", () => {
    expect(oncallText("queue_stuck", 12)).toBe("CVH: texts are not being sent. Waiting more than 5 minutes: 12. Check the Hub.");
    expect(oncallText("delivery_unknown", 1)).toBe("CVH: texts with an unknown outcome: 1. Check the Hub.");
    expect(oncallText("sender_stalled", 40)).toBe("CVH: no sender has run for over 3 minutes. Texts waiting: 40. Check sending.");
    expect(oncallText("signature_failures", 9)).toBe("CVH: Twilio callbacks that failed the signature check in 10 minutes: 9. Check the Hub.");
    expect(oncallText("smart_encoding_on", 1)).toContain("Smart Encoding is on");
  });

  it("names the conditions S09.01 adds, with their count where they count something", () => {
    expect(oncallText("job_failed", 3)).toBe("CVH: scheduled jobs failed in the last 10 minutes: 3. Check the Hub.");
    expect(oncallText("translation_fallback", 1)).toBe("CVH: alerts with a whole language in English because translation failed, last 24 hours: 1. Check the Hub.");
    expect(oncallText("publish_failed", 2)).toBe("CVH: the directory publish failed. Residents still see the previous directory. Check the Hub.");
    expect(oncallText("transactional_ceiling", 301)).toBe("CVH: sign-up and reply texts today passed the daily limit: 301. They keep sending. Check the Hub.");
    expect(oncallText("cap_overrun", 1)).toBe("CVH: an approval went over the monthly text spending cap. Texts keep sending. Check the Hub.");
  });
});
