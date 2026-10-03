import { describe, expect, it } from "vitest";
import { textingIsLive } from "./textingLive";

const twilio = { accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", authToken: "token", messagingServiceSid: "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" };

describe("when texting is live (the on-call approval rule applies)", () => {
  it("is live only in SMS_MODE=live with Twilio's account and Messaging Service set", () => {
    expect(textingIsLive({ smsMode: "live", twilio })).toBe(true);
  });

  it("is not live outside production (SMS_MODE=log), even with credentials", () => {
    expect(textingIsLive({ smsMode: "log", twilio })).toBe(false);
    expect(textingIsLive({ smsMode: "log", twilio: undefined })).toBe(false);
  });

  it("is not live in production until Twilio is set up: no account, no Messaging Service (the owner's case today)", () => {
    expect(textingIsLive({ smsMode: "live", twilio: undefined })).toBe(false);
    expect(textingIsLive({ smsMode: "live", twilio: { accountSid: twilio.accountSid, authToken: twilio.authToken } })).toBe(false);
    expect(textingIsLive({ smsMode: "live", twilio: { ...twilio, messagingServiceSid: "" } })).toBe(false);
  });
});
