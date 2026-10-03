import { describe, expect, it, vi } from "vitest";
import { describeOutcome, sendTestFromForm } from "./sendTest";

const NEXT = "01900000-0000-7000-8000-00000000f099";
const SID = `SM${"0123456789abcdef".repeat(2)}`;

describe("describeOutcome", () => {
  it("shows Twilio's response status and the message id for a text it accepted", () => {
    expect(describeOutcome({ kind: "sent", httpStatus: 201, status: "queued", messageId: SID }, NEXT)).toEqual({
      status: "sent",
      heading: "Twilio accepted the test text",
      lines: ["Twilio’s response: HTTP 201, status queued", `Message id: ${SID}`, "Delivery is not tracked in this check: look at the phone."],
      nextRequestId: NEXT,
    });
  });

  it("shows the provider's error code and message, and says nothing was retried", () => {
    expect(describeOutcome({ kind: "provider_error", httpStatus: 400, errorCode: 30032, message: "Toll-Free Number Has Not Been Verified" }, NEXT)).toEqual({
      status: "failed",
      heading: "Twilio did not send the test text",
      lines: ["Twilio error 30032: Toll-Free Number Has Not Been Verified", "Nothing was retried. Fix the cause, then press the button again."],
      nextRequestId: NEXT,
    });
    expect(describeOutcome({ kind: "provider_error", httpStatus: 401, errorCode: null, message: "Authenticate" }, NEXT)).toMatchObject({ lines: ["Twilio answered HTTP 401: Authenticate", expect.any(String)] });
    expect(describeOutcome({ kind: "provider_error", httpStatus: 502, errorCode: null, message: null }, NEXT)).toMatchObject({ lines: ["Twilio answered HTTP 502 without an error message.", expect.any(String)] });
  });

  it("says the text may have gone when Twilio did not answer", () => {
    expect(describeOutcome({ kind: "no_answer" }, NEXT)).toMatchObject({ status: "failed", heading: "Twilio did not answer", lines: [expect.stringContaining("may or may not have been sent")] });
  });

  it.each([
    ["not_allowlisted", "That phone is not on the approved list. Nothing was sent."],
    ["paused", "Texts are paused, and this page stops with them. Nothing was sent. Resume texts first, then try again."],
    ["duplicate_number", "A test text went to that phone in the last 5 minutes. Nothing was sent. Wait, then try again."],
    ["duplicate_request", "This request was already sent. Nothing more was sent. Press the button again to send a new one."],
    ["not_available", "Texts cannot be sent from here. Nothing was sent."],
    ["invalid", "That request was not understood. Reload the page and try again."],
  ] as const)("explains the refusal %s", (reason, message) => {
    expect(describeOutcome({ kind: "refused", reason }, NEXT)).toEqual({ status: "refused", message, nextRequestId: NEXT });
  });
});

describe("sendTestFromForm", () => {
  const fake = () => ({
    sendTestText: vi.fn(async () => ({ kind: "refused", reason: "duplicate_number" }) as const),
    refuseNotAllowlisted: vi.fn(async () => ({ kind: "refused", reason: "not_allowlisted" }) as const),
  });
  const resolveNumber = (choice: string) => (choice === "choice-1" ? "+14165550101" : undefined);

  it("resolves the opaque choice on the server and passes the signed-in person, the request id and the resolved number, and nothing else, to the use case", async () => {
    const service = fake();
    const form = new FormData();
    form.set("requestId", "r1");
    form.set("number", "choice-1");
    form.set("extra", "ignored");

    await sendTestFromForm({ service: () => service, resolveNumber, newRequestId: () => NEXT }, { staffId: "s1" }, form);

    expect(service.sendTestText).toHaveBeenCalledWith({ actorStaffId: "s1", requestId: "r1", number: "+14165550101" });
    expect(service.refuseNotAllowlisted).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown choice", "choice-9"],
    ["a tampered choice", "choice-1 "],
    ["a full number typed in", "+14165550101"],
    ["no choice at all", undefined],
  ])("refuses %s as not on the approved list, audited, and never reaches the send", async (_name, choice) => {
    const service = fake();
    const form = new FormData();
    form.set("requestId", "r1");
    if (choice !== undefined) form.set("number", choice);

    const state = await sendTestFromForm({ service: () => service, resolveNumber, newRequestId: () => NEXT }, { staffId: "s1" }, form);

    expect(state).toEqual({ status: "refused", message: "That phone is not on the approved list. Nothing was sent.", nextRequestId: NEXT });
    expect(service.refuseNotAllowlisted).toHaveBeenCalledWith("s1");
    expect(service.sendTestText).not.toHaveBeenCalled();
  });
});
