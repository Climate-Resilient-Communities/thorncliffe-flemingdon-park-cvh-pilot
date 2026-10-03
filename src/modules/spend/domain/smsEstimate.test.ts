import { describe, expect, it } from "vitest";
import { SMS_KIND, SMS_MODEL, SMS_SEGMENTS_MAX, SmsEstimateError, toSmsEstimate } from "./smsEstimate";

const DELIVERY = "01900000-0000-7000-8000-0000000d0001";
const ENTRY = "01900000-0000-7000-8000-0000000e0001";
const alert = { deliveryId: DELIVERY, entryId: ENTRY, lang: "ur", isDrill: false, segments: 2, costCents: 3, purpose: "alert" } as const;

describe("the estimate of a text message (S06.08)", () => {
  it("is kind sms, from the Twilio service, and holds the delivery, the entry, the language, the drill flag, the segments and the cost", () => {
    expect(SMS_KIND).toBe("sms");
    expect(SMS_MODEL).toBe("twilio");
    expect(toSmsEstimate(alert)).toEqual(alert);
  });

  it("takes a transactional or campaign text with no entry, and an alert only with one", () => {
    expect(toSmsEstimate({ ...alert, entryId: null, purpose: "transactional" })).toMatchObject({ entryId: null, purpose: "transactional" });
    expect(toSmsEstimate({ ...alert, entryId: null, purpose: "campaign" })).toMatchObject({ purpose: "campaign" });
    expect(() => toSmsEstimate({ ...alert, entryId: null })).toThrow(SmsEstimateError);
    expect(() => toSmsEstimate({ ...alert, purpose: "transactional" })).toThrow(SmsEstimateError);
  });

  it("takes the ids as the database's uuid column holds them (any 8-4-4-4-12 hex), so an id seeded by hand never fails the outcome write the estimate rides in, and still refuses what is not an id", () => {
    const hand = { deliveryId: "00000000-0000-0000-0000-000000000001", entryId: "FFFFFFFF-ffff-FFFF-ffff-ffffffffffff" };
    expect(toSmsEstimate({ ...alert, ...hand })).toMatchObject(hand);
    for (const bad of ["", "0000000000000000000000000000000", "00000000-0000-0000-0000-00000000000g", "00000000-0000-0000-0000-0000000000011", " 00000000-0000-0000-0000-000000000001"]) {
      expect(() => toSmsEstimate({ ...alert, deliveryId: bad }), bad).toThrow(SmsEstimateError);
      expect(() => toSmsEstimate({ ...alert, entryId: bad }), bad).toThrow(SmsEstimateError);
    }
  });

  it("can carry the instant it was made (a test gives it; production leaves it to the database)", () => {
    const at = new Date("2026-11-01T04:00:01Z");
    expect(toSmsEstimate({ ...alert, at }).at).toEqual(at);
    expect(toSmsEstimate(alert).at).toBeUndefined();
  });

  it("is refused with a field it does not know, so no number or text can be stored", () => {
    expect(() => toSmsEstimate({ ...alert, to: "+14165550123" } as never)).toThrow(SmsEstimateError);
    expect(() => toSmsEstimate({ ...alert, body: "Power is out" } as never)).toThrow(SmsEstimateError);
  });

  it.each([
    ["a delivery that is not an id", { deliveryId: "not-an-id" }],
    ["a language that is not a code", { lang: "Urdu (Pakistan)" }],
    ["no segments", { segments: 0 }],
    [`more segments than a text can have (${SMS_SEGMENTS_MAX})`, { segments: SMS_SEGMENTS_MAX + 1 }],
    ["a fractional segment count", { segments: 1.5 }],
    ["a negative cost", { costCents: -1 }],
    ["a fractional cost (an estimate is whole cents)", { costCents: 1.5 }],
    ["a purpose it does not know", { purpose: "marketing" }],
  ])("is refused with %s", (_name, change) => {
    expect(() => toSmsEstimate({ ...alert, ...change } as never)).toThrow(SmsEstimateError);
  });

  it("names only the fields that are wrong, never their values", () => {
    try {
      toSmsEstimate({ ...alert, lang: "+14165550123" });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe("sms estimate is invalid (lang)");
    }
  });
});
