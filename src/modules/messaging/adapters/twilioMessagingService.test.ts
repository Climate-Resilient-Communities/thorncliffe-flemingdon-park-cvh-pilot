// The Messaging Service adapter against a fake `fetch`: no network call is ever made.
import { describe, expect, it, vi } from "vitest";
import { twilioMessageSubmitter, twilioMessagingServiceReader, notSentReason } from "./twilioMessagingService";

// Obviously fake credentials and numbers.
const ACCOUNT_SID = `AC${"0".repeat(32)}`;
const AUTH_TOKEN = "fake-auth-token-for-tests";
const SERVICE_SID = `MG${"1".repeat(32)}`;
const MESSAGE_SID = `SM${"ab12".repeat(8)}`;
const REF = "0190aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SUBMISSION = {
  to: "+14165550101",
  body: "عمارت 12 میں بجلی بند ہے۔ Reply STOP",
  messagingServiceSid: SERVICE_SID,
  statusCallback: `https://cvh.example/api/twilio/status?ref=${REF}`,
};

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The error `fetch` throws when the connection fails: `TypeError: fetch failed` with the system error as its cause. */
const fetchFailed = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${code}`), { code }) });

function submitter(respond: () => Promise<Response>) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => respond());
  return {
    fetchMock,
    sms: twilioMessageSubmitter({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, baseUrl: "https://twilio.invalid", fetch: fetchMock as unknown as typeof fetch }),
  };
}

describe("the Messaging Service submission", () => {
  it("posts the frozen body through the Messaging Service with SmartEncoded=false and the status callback URL, and no From number", async () => {
    const { fetchMock, sms } = submitter(async () => json({ sid: MESSAGE_SID, status: "queued" }, 201));

    await expect(sms.submit(SUBMISSION)).resolves.toEqual({ kind: "accepted", httpStatus: 201, status: "queued", messageId: MESSAGE_SID });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://twilio.invalid/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`);
    expect(init?.method).toBe("POST");
    const form = Object.fromEntries(new URLSearchParams(init?.body as string));
    expect(form).toEqual({
      To: SUBMISSION.to,
      // Byte for byte: URL encoding of the form and back leaves the Urdu text exactly as frozen.
      Body: SUBMISSION.body,
      MessagingServiceSid: SERVICE_SID,
      StatusCallback: SUBMISSION.statusCallback,
      SmartEncoded: "false",
    });
    expect(form).not.toHaveProperty("From");
    // The credentials travel only in the header, and a redirect is never followed with them.
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64")}`);
    expect(String(url)).not.toContain(AUTH_TOKEN);
    expect(init?.body as string).not.toContain(AUTH_TOKEN);
    expect(init?.redirect).toBe("error");
  });

  it("sets SmartEncoded=false on every request: the caller has no way to leave it out or turn it on", async () => {
    const { fetchMock, sms } = submitter(async () => json({ sid: MESSAGE_SID, status: "queued" }, 201));
    // Even a submission carrying such a field (a bug in a caller) cannot change it: the adapter builds the form itself.
    await sms.submit({ ...SUBMISSION, SmartEncoded: "true" } as typeof SUBMISSION);
    await sms.submit({ ...SUBMISSION, body: "Plain text. Reply STOP" });
    for (const [, init] of fetchMock.mock.calls) expect(new URLSearchParams(init?.body as string).getAll("SmartEncoded")).toEqual(["false"]);
  });

  it("returns an error's code and message as the provider's answer, with any phone number in the message masked to its last two digits", async () => {
    const { sms } = submitter(async () => json({ code: 21211, message: "The 'To' number +14165550101 is not a valid phone number.", status: 400 }, 400));
    const answer = await sms.submit(SUBMISSION);
    expect(answer).toEqual({ kind: "rejected", httpStatus: 400, errorCode: 21211, message: "The 'To' number +*********01 is not a valid phone number." });
    expect(JSON.stringify(answer)).not.toContain("5550101");
  });

  it("returns a 429 with its error body, a 5xx and a rejection with no body as HTTP statuses (what they mean is the dispatcher's rule)", async () => {
    const limited = submitter(async () => json({ code: 20429, message: "Too many requests", status: 429 }, 429));
    await expect(limited.sms.submit(SUBMISSION)).resolves.toEqual({ kind: "rejected", httpStatus: 429, errorCode: 20429, message: "Too many requests" });
    const failing = submitter(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(failing.sms.submit(SUBMISSION)).resolves.toEqual({ kind: "rejected", httpStatus: 502, errorCode: null, message: null });
    const server = submitter(async () => json({ code: 20500, message: "Internal Server Error" }, 500));
    await expect(server.sms.submit(SUBMISSION)).resolves.toEqual({ kind: "rejected", httpStatus: 500, errorCode: 20500, message: "Internal Server Error" });
  });

  it("sends once and never retries, whatever fails", async () => {
    for (const respond of [
      async () => json({ code: 20429, message: "Too many requests" }, 429),
      async () => {
        throw fetchFailed("ECONNREFUSED");
      },
      async () => {
        throw fetchFailed("ECONNRESET");
      },
      async () => json({ sid: MESSAGE_SID }, 201),
    ]) {
      const { fetchMock, sms } = submitter(respond);
      await sms.submit(SUBMISSION);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  describe("a connection that failed before any of the request was sent (the only failure that is retried)", () => {
    it.each([
      ["ECONNREFUSED", "connection_refused"],
      ["ENOTFOUND", "host_not_found"],
      ["EAI_AGAIN", "host_not_found"],
      ["ENETUNREACH", "network_unreachable"],
      ["EHOSTUNREACH", "network_unreachable"],
      ["UND_ERR_CONNECT_TIMEOUT", "connect_timeout"],
      ["CERT_HAS_EXPIRED", "tls_failed"],
      ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls_failed"],
      ["ERR_TLS_CERT_ALTNAME_INVALID", "tls_failed"],
      ["ERR_SSL_WRONG_VERSION_NUMBER", "tls_failed"],
    ])("is not_sent for %s (%s)", async (code, reason) => {
      const { sms } = submitter(async () => {
        throw fetchFailed(code);
      });
      await expect(sms.submit(SUBMISSION)).resolves.toEqual({ kind: "not_sent", reason });
    });

    it("finds the code however deep the cause is, and says nothing for an error with no code", () => {
      expect(notSentReason(Object.assign(new Error("a"), { cause: Object.assign(new Error("b"), { cause: { code: "ECONNREFUSED" } }) }))).toBe("connection_refused");
      expect(notSentReason(new Error("no code"))).toBeUndefined();
      expect(notSentReason("not an error")).toBeUndefined();
    });
  });

  describe("anything after the request may have been sent (never retried, so the text is unknown)", () => {
    it.each([["ECONNRESET"], ["UND_ERR_SOCKET"], ["EPIPE"], ["ETIMEDOUT"], ["UND_ERR_HEADERS_TIMEOUT"]])("a dropped connection (%s) is connection_lost, not not_sent", async (code) => {
      const { sms } = submitter(async () => {
        throw fetchFailed(code);
      });
      await expect(sms.submit(SUBMISSION)).resolves.toEqual({ kind: "no_answer", reason: "connection_lost" });
    });

    it("a timeout after the request is sent is no_answer, not not_sent", async () => {
      const { sms } = submitter(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      });
      await expect(sms.submit(SUBMISSION)).resolves.toEqual({ kind: "no_answer", reason: "timeout" });
    });

    it("an error with no system code at all is connection_lost (the safe reading), never a retry", async () => {
      const { sms } = submitter(async () => {
        throw new Error("something unexpected");
      });
      await expect(sms.submit(SUBMISSION)).resolves.toEqual({ kind: "no_answer", reason: "connection_lost" });
    });

    it("an acceptance (2xx) whose body then cannot be read because the connection dropped is accepted_then_dropped", async () => {
      const dropped = { ok: true, status: 201, text: () => Promise.reject(new TypeError("terminated")) } as unknown as Response;
      const { sms } = submitter(async () => dropped);
      await expect(sms.submit(SUBMISSION)).resolves.toEqual({ kind: "no_answer", reason: "accepted_then_dropped" });
    });

    it("an acceptance followed by another failure while reading the answer is accepted_then_error", async () => {
      const broken = { ok: true, status: 202, text: () => Promise.reject(new RangeError("invalid state")) } as unknown as Response;
      const { sms } = submitter(async () => broken);
      await expect(sms.submit(SUBMISSION)).resolves.toEqual({ kind: "no_answer", reason: "accepted_then_error" });
    });

    it("a 2xx with no usable message id is unusable_response: the text may have been taken, so it is not `accepted`", async () => {
      for (const respond of [
        async () => json({ status: "queued" }, 201),
        async () => json({ sid: "not-a-sid" }, 201),
        async () => new Response("ok", { status: 200 }),
        async () => json(null, 201),
      ]) {
        const { sms } = submitter(respond);
        await expect(sms.submit(SUBMISSION)).resolves.toEqual({ kind: "no_answer", reason: "unusable_response" });
      }
    });
  });

  it("never puts the credentials in an answer, whichever way it fails", async () => {
    for (const respond of [
      async () => json({ code: 20003, message: `Authenticate ${AUTH_TOKEN}` }, 401),
      async () => {
        throw fetchFailed("ECONNREFUSED");
      },
    ]) {
      const { sms } = submitter(respond);
      const answer = await sms.submit(SUBMISSION);
      expect(JSON.stringify(answer)).not.toContain(ACCOUNT_SID);
    }
  });
});

describe("the Messaging Service's Smart Encoding setting", () => {
  function reader(respond: () => Promise<Response>) {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => respond());
    return { fetchMock, service: twilioMessagingServiceReader({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, messagingBaseUrl: "https://messaging.invalid", fetch: fetchMock as unknown as typeof fetch }) };
  }

  it("reads smart_encoding from the service resource with basic auth, and changes nothing", async () => {
    const off = reader(async () => json({ sid: SERVICE_SID, smart_encoding: false }, 200));
    await expect(off.service.readSmartEncoding(SERVICE_SID)).resolves.toEqual({ kind: "read", smartEncoding: false });
    const [url, init] = off.fetchMock.mock.calls[0];
    expect(url).toBe(`https://messaging.invalid/v1/Services/${SERVICE_SID}`);
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64")}`);
    expect(init?.body).toBeUndefined();

    const on = reader(async () => json({ sid: SERVICE_SID, smart_encoding: true }, 200));
    await expect(on.service.readSmartEncoding(SERVICE_SID)).resolves.toEqual({ kind: "read", smartEncoding: true });
  });

  it("says it could not tell when the setting is missing, not a boolean, the request fails or the service id is not one", async () => {
    await expect(reader(async () => json({ sid: SERVICE_SID }, 200)).service.readSmartEncoding(SERVICE_SID)).resolves.toEqual({ kind: "unreadable", reason: "setting_missing" });
    await expect(reader(async () => json({ smart_encoding: "false" }, 200)).service.readSmartEncoding(SERVICE_SID)).resolves.toEqual({ kind: "unreadable", reason: "setting_missing" });
    await expect(reader(async () => json({ code: 20404 }, 404)).service.readSmartEncoding(SERVICE_SID)).resolves.toEqual({ kind: "unreadable", reason: "http_404" });
    await expect(
      reader(async () => {
        throw fetchFailed("ECONNREFUSED");
      }).service.readSmartEncoding(SERVICE_SID),
    ).resolves.toEqual({ kind: "unreadable", reason: "unreachable" });
    const none = reader(async () => json({}, 200));
    await expect(none.service.readSmartEncoding("not-a-service-sid")).resolves.toEqual({ kind: "unreadable", reason: "service_sid_invalid" });
    expect(none.fetchMock).not.toHaveBeenCalled();
  });
});
