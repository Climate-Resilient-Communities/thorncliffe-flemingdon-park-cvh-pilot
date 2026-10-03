// The Messages listing adapter against a fake `fetch`: no network call is ever made, and the adapter is never given real credentials.
import { describe, expect, it, vi } from "vitest";
import { monthInterval } from "../../spend";
import { MessageListError, twilioMessageLister } from "./twilioMessageList";

// Obviously fake credentials.
const ACCOUNT_SID = `AC${"0".repeat(32)}`;
const AUTH_TOKEN = "fake-auth-token-for-tests";
const PATH = `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;
const sid = (n: number) => `SM${n.toString(16).padStart(32, "0")}`;
const RANGE = { startUtc: new Date("2026-10-01T04:00:00Z"), endUtc: new Date("2026-11-01T04:00:00Z") };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const item = (n: number, over: Record<string, unknown> = {}) => ({
  sid: sid(n),
  direction: "outbound-api",
  date_sent: "Thu, 15 Oct 2026 14:00:00 +0000",
  price: "-0.00790",
  price_unit: "USD",
  status: "delivered",
  // Fields a listing carries and this adapter must never pass on: the number and the text.
  to: "+14165550123",
  body: "Power is out in Building 12",
  ...over,
});

function lister(respond: (url: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (url) => respond(url));
  return { fetchMock, listing: twilioMessageLister({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, baseUrl: "https://twilio.invalid", fetch: fetchMock as unknown as typeof fetch }) };
}

describe("the Messages listing (S06.08)", () => {
  it("asks for the account's messages with Twilio's documented date filters (GMT dates, a day either side of the interval), at the largest page size, with the credentials only in the header", async () => {
    const { fetchMock, listing } = lister(() => json({ messages: [item(1)], next_page_uri: null }));
    await listing.first(RANGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(`https://twilio.invalid${PATH}`);
    // Dates only (`YYYY-MM-DD`, GMT), as the SDK documents them: never a time or milliseconds. October in Toronto is [2026-10-01T04:00Z, 2026-11-01T04:00Z),
    // so the request runs from the day before the first GMT date to the day after the last one.
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ PageSize: "1000", "DateSent>": "2026-09-30", "DateSent<": "2026-11-02" });
    expect(init?.method).toBe("GET");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64")}`);
    expect(url).not.toContain(AUTH_TOKEN);
    expect(init?.redirect).toBe("error");
    expect(init?.body).toBeUndefined();
  });

  it.each([
    ["a month that starts in daylight time and ends in standard time", "2026-10", "2026-09-30", "2026-11-02"],
    ["a month that ends on a date in GMT already the next month's", "2026-08", "2026-07-31", "2026-09-02"],
    ["a month that starts when the clocks change back", "2026-11", "2026-10-31", "2026-12-02"],
    ["a month across a new year", "2026-12", "2026-11-30", "2027-01-02"],
  ])("asks only for GMT dates, one whole day beyond the interval on each side, for %s", async (_name, month, after, before) => {
    const { fetchMock, listing } = lister(() => json({ messages: [], next_page_uri: null }));
    const interval = monthInterval(month);
    await listing.first({ startUtc: interval.startUtc, endUtc: interval.endUtc });
    const params = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]).searchParams;
    expect(params.get("DateSent>")).toBe(after);
    expect(params.get("DateSent<")).toBe(before);
    for (const bound of [params.get("DateSent>"), params.get("DateSent<")]) expect(bound).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Whatever Twilio does with a bound (inclusive or not, by the day), the requested dates hold every instant of the interval: a day to spare either side.
    expect(Date.parse(`${after}T23:59:59Z`)).toBeLessThan(interval.startUtc.getTime());
    expect(Date.parse(`${before}T00:00:00Z`)).toBeGreaterThan(interval.endUtc.getTime());
  });

  it("gives the id, direction, send time and price of each message, and nothing else: never a number or a body", async () => {
    const { listing } = lister(() => json({ messages: [item(1), item(2, { date_sent: null, price: null, price_unit: null, direction: "inbound" })], next_page_uri: `${PATH}?Page=1&PageToken=abc` }));
    const page = await listing.first(RANGE);
    expect(page.nextPageUri).toBe(`${PATH}?Page=1&PageToken=abc`);
    // The status is a code (`delivered`, `failed`, ...): kept so a decision about messages Twilio never prices needs no change here.
    expect(page.messages).toEqual([
      { sid: sid(1), direction: "outbound-api", dateSent: new Date("2026-10-15T14:00:00Z"), price: "-0.00790", priceUnit: "USD", status: "delivered" },
      { sid: sid(2), direction: "inbound", dateSent: null, price: null, priceUnit: null, status: "delivered" },
    ]);
    expect(JSON.stringify(page)).not.toContain("5550123");
    expect(JSON.stringify(page)).not.toContain("Power is out");
  });

  it("follows a next_page_uri as the page gave it, on the account's own Messages resource, until a page gives none", async () => {
    const pages: Record<string, unknown> = {
      [`https://twilio.invalid${PATH}?Page=1&PageToken=abc`]: { messages: [item(3)], next_page_uri: `${PATH}?Page=2&PageToken=def` },
      [`https://twilio.invalid${PATH}?Page=2&PageToken=def`]: { messages: [item(4)], next_page_uri: null },
    };
    const { fetchMock, listing } = lister((url) => json(pages[url] ?? { error: true }, pages[url] ? 200 : 404));
    const first = await listing.next(`${PATH}?Page=1&PageToken=abc`);
    expect(first.messages.map((m) => m.sid)).toEqual([sid(3)]);
    const second = await listing.next(first.nextPageUri ?? "");
    expect(second).toEqual({ messages: [expect.objectContaining({ sid: sid(4) })], nextPageUri: null });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(Object.keys(pages));
  });

  it("treats an empty next_page_uri as the last page", async () => {
    const { listing } = lister(() => json({ messages: [], next_page_uri: "" }));
    expect((await listing.first(RANGE)).nextPageUri).toBeNull();
  });

  it.each([
    ["another host", "https://evil.example/2010-04-01/Accounts/x/Messages.json?Page=1"],
    ["a protocol-relative URL", `//evil.example${PATH}?Page=1`],
    ["another account", "/2010-04-01/Accounts/AC11111111111111111111111111111111/Messages.json?Page=1"],
    ["another resource of the account", `/2010-04-01/Accounts/${ACCOUNT_SID}/Calls.json?Page=1`],
    ["a path that only starts like the Messages resource", `${PATH}/../Calls.json`],
    ["a relative path", "Messages.json?Page=1"],
    ["nothing", ""],
  ])("never sends the credentials to %s", async (_name, uri) => {
    const { fetchMock, listing } = lister(() => json({ messages: [], next_page_uri: null }));
    await expect(listing.next(uri)).rejects.toMatchObject({ name: "MessageListError", code: "next_page_refused" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails, with a code and never the provider's answer, when the provider refuses or cannot be read", async () => {
    const refused = lister(() => json({ code: 20003, message: "Authenticate. Account +14165550123 token abc" }, 401));
    const refusal = (await refused.listing.first(RANGE).catch((error: unknown) => error)) as MessageListError;
    expect(refusal).toBeInstanceOf(MessageListError);
    expect(refusal.code).toBe("http_status");
    expect(`${refusal.message} ${JSON.stringify(refusal)} ${refusal.stack}`).not.toMatch(/5550123|Authenticate|token abc/);

    const html = lister(() => new Response("<html>sign in</html>", { status: 200 }));
    await expect(html.listing.first(RANGE)).rejects.toMatchObject({ code: "unreadable" });

    const down = twilioMessageLister({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, fetch: (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch });
    await expect(down.first(RANGE)).rejects.toMatchObject({ code: "request_failed" });

    const redirected = twilioMessageLister({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, fetch: (async () => Promise.reject(new TypeError("redirect mode is set to error"))) as unknown as typeof fetch });
    await expect(redirected.first(RANGE)).rejects.toMatchObject({ code: "request_failed" });
  });

  it("fails when what it got is not a page, or does not say whether there is a next one (it may have been cut off)", async () => {
    for (const body of [[], { messages: "none", next_page_uri: null }, { messages: [] }, { messages: [], next_page_uri: 5 }, { messages: [7], next_page_uri: null }, null]) {
      const { listing } = lister(() => json(body));
      await expect(listing.first(RANGE), JSON.stringify(body)).rejects.toMatchObject({ code: "not_a_page" });
    }
  });

  it("passes on a message with a field of the wrong type as one the reconciliation will find malformed, not as a failed listing", async () => {
    const { listing } = lister(() => json({ messages: [item(1, { sid: 12, date_sent: "not a date", price: 0.0079, direction: null })], next_page_uri: null }));
    expect((await listing.first(RANGE)).messages).toEqual([{ sid: "", direction: "", dateSent: null, price: null, priceUnit: "USD", status: "delivered" }]);
  });

  it("waits for a page no longer than its timeout, and asks for smaller pages when told to", async () => {
    const waits: number[] = [];
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => (waits.push(ms), new AbortController().signal));
    try {
      const fetchMock = vi.fn(async () => json({ messages: [], next_page_uri: null }));
      const own = twilioMessageLister({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, fetch: fetchMock as unknown as typeof fetch, timeoutMs: 1234, pageSize: 50 });
      await own.first(RANGE);
      await lister(() => json({ messages: [], next_page_uri: null })).listing.first(RANGE);
      expect(waits).toEqual([1234, 15_000]);
      expect(new URL((fetchMock.mock.calls[0] as unknown as [string])[0]).searchParams.get("PageSize")).toBe("50");
    } finally {
      spy.mockRestore();
    }
  });

  it("waits for a page no longer than the time the run has left, never longer than its own timeout, and at least a millisecond", async () => {
    const waits: number[] = [];
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => (waits.push(ms), new AbortController().signal));
    try {
      const { listing } = lister(() => json({ messages: [], next_page_uri: null }));
      await listing.first(RANGE, { timeoutMs: 2_500 });
      await listing.next(`${PATH}?Page=1&PageToken=abc`, { timeoutMs: 700.9 });
      await listing.first(RANGE, { timeoutMs: 60_000 });
      await listing.first(RANGE, { timeoutMs: 0 });
      await listing.first(RANGE, {});
      expect(waits).toEqual([2_500, 700, 15_000, 1, 15_000]);
    } finally {
      spy.mockRestore();
    }
  });
});
