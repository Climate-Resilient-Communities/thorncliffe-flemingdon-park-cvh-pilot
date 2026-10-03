import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "9d1f6b3a8c2e4075a1b9c0d3e6f2a8b45c7d9e0f1a3b5c7d2e4f6a8b0c1d3e5f";

// What the composition root does, set by each test. The route is about authentication and the shape of its answers; the job itself is tested
// against the database (test/db/healthJob.db.test.ts).
const state = vi.hoisted(() => ({ run: undefined as undefined | (() => Promise<unknown>), runs: 0, jobSecrets: [] as string[] }));
vi.mock("@/app/health", () => ({
  runHealthJob: () => {
    state.runs += 1;
    return (state.run ?? (async () => ({ conditions: [] })))();
  },
}));
vi.mock("@/platform/config/env", () => ({ getEnv: () => ({ jobSecrets: state.jobSecrets }) }));

const { POST, GET, maxDuration, dynamic } = await import("./route");

const post = (authorization?: string) => POST(new Request("https://cvh.example/api/jobs/health", { method: "POST", headers: authorization === undefined ? {} : { authorization } }));
const OK = { conditions: [{ condition: "queue_stuck", status: "ok", holds: false, action: "quiet" }] };

beforeEach(() => {
  state.run = undefined;
  state.runs = 0;
  state.jobSecrets = [SECRET];
  vi.restoreAllMocks();
});

describe("POST /api/jobs/health", () => {
  it("refuses a request without the job secret, and runs nothing", async () => {
    for (const header of [undefined, "Bearer nope", `Basic ${SECRET}`]) {
      const response = await post(header);
      expect(response.status).toBe(401);
    }
    expect(state.runs).toBe(0);
  });

  it("answers 503 and runs nothing while no job secret is set", async () => {
    state.jobSecrets = [];
    expect((await post(`Bearer ${SECRET}`)).status).toBe(503);
    expect(state.runs).toBe(0);
  });

  it("accepts the previous secret during a rotation", async () => {
    state.jobSecrets = ["a".repeat(64), SECRET];
    expect((await post(`Bearer ${SECRET}`)).status).toBe(200);
  });

  it("runs the job and answers with the report, never cached", async () => {
    state.run = async () => OK;
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(OK);
    expect(state.runs).toBe(1);
  });

  it("answers 500 when every condition failed (the database is unreachable), so pg_cron's run shows an error", async () => {
    state.run = async () => ({ conditions: [{ condition: "queue_stuck", status: "failed" }, { condition: "sender_stalled", status: "failed" }] });
    expect((await post(`Bearer ${SECRET}`)).status).toBe(500);
  });

  it("answers 200 when only some conditions failed: the run did its work and logged the others by name", async () => {
    state.run = async () => ({ conditions: [{ condition: "queue_stuck", status: "failed" }, { condition: "sender_stalled", status: "ok", holds: false, action: "quiet" }] });
    expect((await post(`Bearer ${SECRET}`)).status).toBe(200);
  });

  it("answers 500 with a code, and logs the error's name only, when the run throws", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    state.run = async () => {
      throw new TypeError("connect ECONNREFUSED 10.0.0.1:5432 for +14165550123");
    };
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "health_failed" } });
    expect(JSON.stringify(log.mock.calls)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(log.mock.calls)).not.toContain("4165550123");
  });

  it("is a POST route that is never prerendered and may run for a minute", async () => {
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(60);
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
