import { describe, expect, it, vi } from "vitest";
import { SearchFailure, type SearchService } from "@/modules/directory";
import type { RateLimiter } from "@/modules/subscriptions";
import { CLOSEST_RATE_LIMIT, closestResponse } from "./handler";

const post = (body: unknown) => new Request("https://cvh.example/api/search/closest", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "x-real-ip": "203.0.113.7" } });

function deps(closest: SearchService["closest"], allowed = true) {
  const checks: string[] = [];
  const limiter: RateLimiter = {
    async check(rule) {
      checks.push(rule.scope);
      return allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 120 };
    },
  };
  const service = { search: vi.fn(), has: vi.fn(), closest } as unknown as SearchService;
  return { checks, deps: { search: () => service, limiter: () => limiter, client: () => "203.0.113.7" } };
}

describe("POST /api/search/closest (session 2, #3)", () => {
  it("answers the closest matches of a question, never cacheable, counted under its own scope", async () => {
    const closest = vi.fn(async () => ({ v: 1 as const, release_v: 13, results: [{ provider_id: "M007" }] }));
    const fake = deps(closest);
    const response = await closestResponse(fake.deps, post({ q: "no puedo pagar el alquiler", lang: "es" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ v: 1, release_v: 13, results: [{ provider_id: "M007" }] });
    expect(closest).toHaveBeenCalledWith({ q: "no puedo pagar el alquiler", lang: "es" });
    expect(fake.checks).toEqual([CLOSEST_RATE_LIMIT.scope]);
  });

  it("refuses a body the search contract refuses, and a client past its limit, without asking the model", async () => {
    const closest = vi.fn();
    expect((await closestResponse(deps(closest).deps, post("not json"))).status).toBe(400);
    expect((await closestResponse(deps(closest).deps, post({ q: "", lang: "es" }))).status).toBe(400);
    const busy = await closestResponse(deps(closest, false).deps, post({ q: "ayuda", lang: "es" }));
    expect(busy.status).toBe(429);
    expect(busy.headers.get("retry-after")).toBe("120");
    expect(closest).not.toHaveBeenCalled();
  });

  it("answers 503 when the release cannot be read, or the model does not answer before the deadline", async () => {
    expect((await closestResponse(deps(async () => Promise.reject(new SearchFailure("search_unavailable"))).deps, post({ q: "ayuda", lang: "es" }))).status).toBe(503);
    const never = deps(() => new Promise(() => undefined));
    expect((await closestResponse({ ...never.deps, deadlineMs: 20 }, post({ q: "ayuda", lang: "es" }))).status).toBe(503);
  });
});
