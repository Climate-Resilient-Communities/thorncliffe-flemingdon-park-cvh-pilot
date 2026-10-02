import { describe, expect, it } from "vitest";
import { askSearch, retryAfterSeconds, SEARCH_URL } from "./search-client";

const answer = { v: 1, release_v: 3, query_lang: "en", status: "ok", emergency_first: false, results: [{ provider_id: "P101", score: 0.8 }] };
const reply = (init: { status?: number; body?: unknown; headers?: Record<string, string> }): typeof fetch =>
  (async () => new Response(typeof init.body === "string" ? init.body : JSON.stringify(init.body ?? answer), { status: init.status ?? 200, headers: init.headers })) as unknown as typeof fetch;

describe("askSearch", () => {
  it("posts the question in the body to /api/search, with no credentials, and nothing in the address", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify(answer));
    }) as unknown as typeof fetch;
    const out = await askSearch({ q: "my landlord", lang: "ur", v: 3 }, { fetcher });
    expect(out).toEqual({ kind: "answer", answer });
    expect(seen!.url).toBe(SEARCH_URL);
    expect(seen!.init.method).toBe("POST");
    expect(seen!.init.credentials).toBe("omit");
    expect(JSON.parse(seen!.init.body as string)).toEqual({ q: "my landlord", lang: "ur", v: 3 });
    expect(JSON.stringify(seen!.init.headers)).not.toContain("landlord");
  });

  it("leaves v out when the phone holds no release", async () => {
    let body = "";
    const fetcher = (async (_: string, init: RequestInit) => {
      body = init.body as string;
      return new Response(JSON.stringify(answer));
    }) as unknown as typeof fetch;
    await askSearch({ q: "x", lang: "en" }, { fetcher });
    expect(JSON.parse(body)).toEqual({ q: "x", lang: "en" });
  });

  it("maps 429 to busy with the Retry-After, or five minutes when it is missing or not a number of seconds", async () => {
    expect(await askSearch({ q: "x", lang: "en" }, { fetcher: reply({ status: 429, headers: { "Retry-After": "120" }, body: {} }) })).toEqual({ kind: "busy", retryAfterSeconds: 120 });
    expect(await askSearch({ q: "x", lang: "en" }, { fetcher: reply({ status: 429, body: {} }) })).toEqual({ kind: "busy", retryAfterSeconds: 300 });
    expect(await askSearch({ q: "x", lang: "en" }, { fetcher: reply({ status: 429, headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" }, body: {} }) })).toEqual({ kind: "busy", retryAfterSeconds: 300 });
  });

  it("caps an unbelievable Retry-After at an hour", () => {
    expect(retryAfterSeconds("999999")).toBe(3600);
    expect(retryAfterSeconds(null)).toBeNull();
  });

  it("maps 503, other refusals, error bodies, bad JSON and a body that is not SearchV1 to failed, never a raw error", async () => {
    const error = { error: { code: "search_unavailable", message_key: "search.search_unavailable" } };
    expect(await askSearch({ q: "x", lang: "en" }, { fetcher: reply({ status: 503, body: error }) })).toEqual({ kind: "failed" });
    expect(await askSearch({ q: "x", lang: "en" }, { fetcher: reply({ status: 400, body: {} }) })).toEqual({ kind: "failed" });
    expect(await askSearch({ q: "x", lang: "en" }, { fetcher: reply({ status: 200, body: error }) })).toEqual({ kind: "failed" });
    expect(await askSearch({ q: "x", lang: "en" }, { fetcher: reply({ body: "<html>" }) })).toEqual({ kind: "failed" });
    expect(await askSearch({ q: "x", lang: "en" }, { fetcher: reply({ body: { ...answer, status: "maybe" } }) })).toEqual({ kind: "failed" });
  });

  it("maps a request that does not arrive, or a made-up service worker answer, to offline", async () => {
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await askSearch({ q: "x", lang: "en" }, { fetcher: down })).toEqual({ kind: "offline" });
    expect(await askSearch({ q: "x", lang: "en" }, { fetcher: reply({ headers: { "x-cvh-fallback": "1" } }) })).toEqual({ kind: "offline" });
  });

  it("gives up on a request that stalls", async () => {
    const stalls = ((_: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    expect(await askSearch({ q: "x", lang: "en" }, { fetcher: stalls, timeoutMs: 20 })).toEqual({ kind: "offline" });
  });
});
