import { describe, expect, it } from "vitest";
import type { PlaceSubmissionRequest, PlaceSubmissionStatus } from "@/contracts/placeSubmission";
import type { RateLimiter } from "@/modules/subscriptions";
import { statusResponse, submitResponse, type PlaceSubmissionRouteDeps } from "./handler";

// The routes' answers with the store and the limiter faked (the store against a real database is test/db/placeSubmissions.db.test.ts).

const BODY = {
  v: 1,
  lang: "en",
  kind: "add",
  type: "offer",
  name: "Thursday food bank",
  what: "Free groceries on Thursday evenings.",
  where: { kind: "address", text: "45 Overlea Blvd" },
};

const STATUS: PlaceSubmissionStatus = {
  v: 1,
  ref: "SEED-2A2A",
  kind: "add",
  status: "declined",
  name: "Thursday food bank",
  what: "Free groceries on Thursday evenings.",
  where: { kind: "address", text: "45 Overlea Blvd" },
  where_text: null,
  sent_at: "2026-11-01T15:00:00.000Z",
  decided_at: "2026-11-03T15:00:00.000Z",
  reason: "noLocation",
};

function fake(options: { allowed?: boolean; limiterFails?: boolean; storeFails?: boolean } = {}) {
  const stored: PlaceSubmissionRequest[] = [];
  const counted: { scope: string; client: string }[] = [];
  const limiter: RateLimiter = {
    async check(rule, address) {
      counted.push({ scope: rule.scope, client: address });
      if (options.limiterFails) throw new Error("connection refused");
      return options.allowed === false ? { allowed: false, retryAfterSeconds: 1200 } : { allowed: true };
    },
  };
  const deps: PlaceSubmissionRouteDeps = {
    async submit(request) {
      if (options.storeFails) throw new Error("database down");
      stored.push(request);
      return { ref: "SEED-2A2A" };
    },
    async status(ref) {
      return ref === STATUS.ref ? STATUS : null;
    },
    unstoredRef: () => "ZZZZ-ZZZZ",
    limiter: () => limiter,
    client: (headers) => headers.get("x-real-ip") ?? "unknown",
    rules: { submit: { scope: "place_submission", limit: 5, windowMs: 3_600_000 }, status: { scope: "place_status", limit: 30, windowMs: 3_600_000 } },
  };
  return { deps, stored, counted };
}

const post = (body: unknown) =>
  new Request("https://cvh.example/api/places/submissions", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "x-real-ip": "203.0.113.7" } });
const get = (ref: string) => new Request(`https://cvh.example/api/places/submissions/${ref}`, { headers: { "x-real-ip": "203.0.113.7" } });
const headersOf = (response: Response) => Object.fromEntries([...response.headers.entries()].sort());

describe("POST /api/places/submissions", () => {
  it("stores a suggestion and answers 202 with its reference code, never cacheable, no cookie", async () => {
    const { deps, stored, counted } = fake();
    const response = await submitResponse(deps, post(BODY));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ v: 1, status: "received", ref: "SEED-2A2A" });
    expect(headersOf(response)).toEqual({ "cache-control": "no-store", "content-type": "application/json" });
    expect(stored).toHaveLength(1);
    expect(counted).toEqual([{ scope: "place_submission", client: "203.0.113.7" }]);
  });

  it("answers a filled-in honeypot like any other and stores nothing", async () => {
    const { deps, stored } = fake();
    const response = await submitResponse(deps, post({ ...BODY, nickname: "spam" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ v: 1, status: "received", ref: "ZZZZ-ZZZZ" });
    expect(stored).toEqual([]);
  });

  it("refuses a body the contract refuses, or too long, or not JSON, before counting the client", async () => {
    const { deps, stored, counted } = fake();
    for (const body of [{ ...BODY, name: "" }, "{not json", JSON.stringify({ ...BODY, what: "x".repeat(9000) })]) {
      const response = await submitResponse(deps, post(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "invalid_request", message_key: "places.errors.invalid_request" } });
    }
    expect(stored).toEqual([]);
    expect(counted).toEqual([]);
  });

  it("answers 429 with a Retry-After once the client sent five in the hour, and stores nothing", async () => {
    const { deps, stored } = fake({ allowed: false });
    const response = await submitResponse(deps, post(BODY));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1200");
    expect(stored).toEqual([]);
  });

  it("answers 503 when the limiter or the store fails", async () => {
    for (const options of [{ limiterFails: true }, { storeFails: true }]) {
      const response = await submitResponse(fake(options).deps, post(BODY));
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("submissions_unavailable");
    }
  });
});

describe("GET /api/places/submissions/{ref}", () => {
  it("reads a suggestion by its code, as typed, counted under its own scope", async () => {
    const { deps, counted } = fake();
    const response = await statusResponse(deps, get("seed2a2a"), "seed2a2a");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(STATUS);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(counted).toEqual([{ scope: "place_status", client: "203.0.113.7" }]);
  });

  it("answers 404 for a code no suggestion has, and for anything that cannot be a code without counting it", async () => {
    const { deps, counted } = fake();
    expect((await statusResponse(deps, get("ABCD-EFGH"), "ABCD-EFGH")).status).toBe(404);
    expect((await statusResponse(deps, get("not-a-code"), "not-a-code")).status).toBe(404);
    expect(counted).toHaveLength(1);
  });

  it("answers 429 to a client trying codes", async () => {
    expect((await statusResponse(fake({ allowed: false }).deps, get("SEED-2A2A"), "SEED-2A2A")).status).toBe(429);
  });
});
