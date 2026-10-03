import { describe, expect, it, vi } from "vitest";
import { RETRANSLATE_URL, STATE_URL, SUBMIT_URL, SubmitCallError, submitApi, type Fetch } from "./submitClient";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const KEY = "0f0e0d0c-0b0a-4908-8706-050403020100";

const entryState = {
  v: 1,
  server_now: "2026-10-04T14:00:00.000Z",
  entry: { id: ENTRY, alert_id: ALERT, kind: "ack", status: "draft", version: 0, content_hash: null, possible_duplicate_of: null },
  attempt: null,
  translations: [],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetching = (respond: () => Response | Promise<Response>) => {
  const fetcher = vi.fn<Fetch>(async () => respond());
  return { fetcher, api: submitApi(fetcher) };
};

describe("submit", () => {
  it("posts the request as JSON to the submit endpoint, with no caching, and reads the contract's answer", async () => {
    const { fetcher, api } = fetching(() => json({ v: 1, state: "committed", outcome: null, entry_state: entryState }));
    const request = { v: 1 as const, alert_id: ALERT, entry_id: ENTRY, key: KEY };

    expect(await api.submit(request)).toMatchObject({ state: "committed", outcome: null });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(SUBMIT_URL);
    expect(init).toMatchObject({ method: "POST", cache: "no-store", headers: { "content-type": "application/json" } });
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it("is an error that the outcome was not seen for a status that is not a success, a body that is not JSON and a body that is not the contract's", async () => {
    await expect(fetching(() => json({ error: "forbidden" }, 403)).api.submit({ v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEY })).rejects.toBeInstanceOf(SubmitCallError);
    await expect(fetching(() => json({ error: "x" }, 502)).api.submit({ v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEY })).rejects.toThrow("status 502");
    await expect(fetching(() => new Response("<html>gateway</html>", { status: 200 })).api.submit({ v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEY })).rejects.toThrow();
    await expect(fetching(() => json({ v: 2, state: "committed" })).api.submit({ v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEY })).rejects.toThrow("unreadable answer");
  });

  it("lets a dropped connection through as the rejection it is", async () => {
    const api = submitApi(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(api.submit({ v: 1, alert_id: ALERT, entry_id: ENTRY, key: KEY })).rejects.toThrow("Failed to fetch");
  });
});

describe("retranslate", () => {
  it("posts to its own endpoint with the version and hash that were seen", async () => {
    const { fetcher, api } = fetching(() => json({ v: 1, state: "running", outcome: null, entry_state: entryState }));
    const request = { v: 1 as const, alert_id: ALERT, entry_id: ENTRY, key: KEY, seen_version: 3, seen_hash: "b".repeat(64) };
    expect((await api.retranslate(request)).state).toBe("running");
    expect(fetcher.mock.calls[0][0]).toBe(RETRANSLATE_URL);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(request);
  });
});

describe("state", () => {
  it("asks for the entry by its ids and reads the contract's body", async () => {
    const { fetcher, api } = fetching(() => json(entryState));
    expect((await api.state(ALERT, ENTRY))?.entry.id).toBe(ENTRY);
    expect(fetcher.mock.calls[0][0]).toBe(`${STATE_URL}?alert=${ALERT}&entry=${ENTRY}`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("is null for an answer that is not a state, so the screen counts it as no attempt seen", async () => {
    expect(await fetching(() => json({ error: "bad_request" }, 400)).api.state(ALERT, ENTRY)).toBeNull();
    expect(await fetching(() => json({ v: 1 })).api.state(ALERT, ENTRY)).toBeNull();
  });
});
