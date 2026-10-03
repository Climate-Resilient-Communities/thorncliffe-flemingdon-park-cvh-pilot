// The Twilio adapter against a fake `fetch`: no network call is ever made.
import { describe, expect, it, vi } from "vitest";
import { twilioSmsProvider } from "./twilioSms";

// Obviously fake credentials and numbers.
const ACCOUNT_SID = `AC${"0".repeat(32)}`;
const AUTH_TOKEN = "fake-auth-token-for-tests";
const MESSAGE_SID = `SM${"ab12".repeat(8)}`;
const TEXT = { to: "+14165550101", from: "+18885550100", body: "CVH test from production" };

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function provider(respond: () => Promise<Response>) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => respond());
  return { fetchMock, sms: twilioSmsProvider({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, baseUrl: "https://twilio.invalid", fetch: fetchMock as unknown as typeof fetch }) };
}

describe("the Twilio adapter", () => {
  it("posts the text to the account's Messages resource with basic auth and returns the status and message id", async () => {
    const { fetchMock, sms } = provider(async () => json({ sid: MESSAGE_SID, status: "queued", to: TEXT.to }, 201));

    await expect(sms.send(TEXT)).resolves.toEqual({ kind: "accepted", httpStatus: 201, status: "queued", messageId: MESSAGE_SID });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://twilio.invalid/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64")}`);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    // Smart Encoding is off on every request (AD-21): the provider sends the frozen body as it is.
    expect(Object.fromEntries(new URLSearchParams(init?.body as string))).toEqual({ To: TEXT.to, From: TEXT.from, Body: TEXT.body, SmartEncoded: "false" });
    // The credentials travel only in the header, and a redirect is never followed with them.
    expect(String(url)).not.toContain(AUTH_TOKEN);
    expect(init?.redirect).toBe("error");
  });

  it("returns Twilio's error code and message, and sends once (no retry), for an error such as an unverified toll-free number", async () => {
    const { fetchMock, sms } = provider(async () => json({ code: 30032, message: "Toll-Free Number Has Not Been Verified", more_info: "https://www.twilio.com/docs/errors/30032", status: 400 }, 400));

    await expect(sms.send(TEXT)).resolves.toEqual({ kind: "rejected", httpStatus: 400, errorCode: 30032, message: "Toll-Free Number Has Not Been Verified" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an invalid-credentials error as the provider's answer", async () => {
    const { sms } = provider(async () => json({ code: 20003, message: "Authenticate", status: 401 }, 401));

    await expect(sms.send(TEXT)).resolves.toEqual({ kind: "rejected", httpStatus: 401, errorCode: 20003, message: "Authenticate" });
  });

  it("returns a rejection without a body as an HTTP status alone, and caps a long message", async () => {
    const empty = provider(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(empty.sms.send(TEXT)).resolves.toEqual({ kind: "rejected", httpStatus: 502, errorCode: null, message: null });

    const long = provider(async () => json({ code: 21211, message: "x".repeat(1000) }, 400));
    const answer = await long.sms.send(TEXT);
    expect(answer.kind === "rejected" && answer.message?.length).toBe(300);
  });

  it("hides any phone number Twilio's error message quotes (a 21211 body), before the message goes anywhere", async () => {
    const { sms } = provider(async () => json({ code: 21211, message: "The 'To' number +14165550101 is not a valid phone number.", status: 400 }, 400));

    const answer = await sms.send(TEXT);

    expect(answer).toEqual({ kind: "rejected", httpStatus: 400, errorCode: 21211, message: "The 'To' number [number] is not a valid phone number." });
    expect(JSON.stringify(answer)).not.toContain("5550101");
  });

  it.each([
    ["a number with spaces and dashes", "Cannot reach 416 555-0101 right now", "Cannot reach [number] right now"],
    ["a number without a plus", "Invalid To 14165550101.", "Invalid To [number]."],
    ["two numbers", "From +18885550100 to +14165550101 failed", "From [number] to [number] failed"],
    ["a number near the 300 character cap (the cap cuts the masked text, never half a number)", `${"x".repeat(280)} +14165550101`, `${"x".repeat(280)} [number]`],
  ])("hides %s in an error message", async (_name, message, expected) => {
    const { sms } = provider(async () => json({ code: 21211, message }, 400));

    const answer = await sms.send(TEXT);

    expect(answer).toMatchObject({ kind: "rejected", message: expected });
  });

  it("answers `unreachable` when the request fails or times out, without retrying", async () => {
    const failing = provider(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(failing.sms.send(TEXT)).resolves.toEqual({ kind: "unreachable" });
    expect(failing.fetchMock).toHaveBeenCalledTimes(1);

    const slow = twilioSmsProvider({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      timeoutMs: 5,
      fetch: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError"))))) as unknown as typeof fetch,
    });
    await expect(slow.send(TEXT)).resolves.toEqual({ kind: "unreachable" });
  });

  it("does not count a 2xx without a message id as sent", async () => {
    const { sms } = provider(async () => json({ status: "queued" }, 201));

    await expect(sms.send(TEXT)).resolves.toEqual({ kind: "unreachable" });
  });

  it("keeps a status word the audit trail can hold, and `unknown` for anything else", async () => {
    const shouting = provider(async () => json({ sid: MESSAGE_SID, status: "Accepted" }, 201));
    await expect(shouting.sms.send(TEXT)).resolves.toMatchObject({ kind: "accepted", status: "accepted" });

    const odd = provider(async () => json({ sid: MESSAGE_SID, status: 7 }, 201));
    await expect(odd.sms.send(TEXT)).resolves.toMatchObject({ kind: "accepted", status: "unknown" });
  });
});
