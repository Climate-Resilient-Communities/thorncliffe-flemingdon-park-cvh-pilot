import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "9d1f6b3a8c2e4075a1b9c0d3e6f2a8b45c7d9e0f1a3b5c7d2e4f6a8b0c1d3e5f";

// What the composition root does, set by each test. The route is about authentication and the shape of its answers; the purge itself is tested against the
// database (test/db/purge.db.test.ts).
const report = (over: Record<string, unknown> = {}) => ({ due: true, deleted: 61, skipped: 1, failed: 0, more: false, completed: true, completedNow: true, ...over });
const state = vi.hoisted(() => ({ run: undefined as undefined | (() => Promise<unknown>), runs: 0, jobSecrets: [] as string[] }));
vi.mock("@/app/pilotEnd", () => ({ PILOT_END_TAG: "pilot-end" }));
vi.mock("@/app/purge", () => ({
  runEndOfPilotPurge: () => {
    state.runs += 1;
    return (state.run ?? (async () => report()))();
  },
}));
vi.mock("@/platform/config/env", () => ({ getEnv: () => ({ jobSecrets: state.jobSecrets }) }));

const revalidated = vi.hoisted(() => [] as unknown[][]);
vi.mock("next/cache", () => ({ revalidateTag: (...args: unknown[]) => revalidated.push(args) }));

const { POST, GET, maxDuration, dynamic } = await import("./route");

const post = (authorization?: string) =>
  POST(new Request("https://cvh.example/api/jobs/end-of-pilot-purge", { method: "POST", headers: authorization === undefined ? {} : { authorization } }));

beforeEach(() => {
  state.run = undefined;
  state.runs = 0;
  revalidated.length = 0;
  state.jobSecrets = [SECRET];
  vi.restoreAllMocks();
});

describe("POST /api/jobs/end-of-pilot-purge", () => {
  it("refuses a request without the job secret, and runs nothing", async () => {
    for (const header of [undefined, "Bearer nope", `Basic ${SECRET}`]) expect((await post(header)).status).toBe(401);
    expect(state.runs).toBe(0);
  });

  it("answers 503 and runs nothing while no job secret is set", async () => {
    state.jobSecrets = [];
    expect((await post(`Bearer ${SECRET}`)).status).toBe(503);
    expect(state.runs).toBe(0);
  });

  it("runs the purge and answers with counts only, never cached; the run that completes it expires the terms page's reading", async () => {
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(report());
    expect(state.runs).toBe(1);
    expect(revalidated).toEqual([["pilot-end", { expire: 0 }]]);
  });

  it("expires nothing when the purge is not due, goes on, or completed in an earlier run", async () => {
    for (const over of [
      { due: false, deleted: 0, skipped: 0, completed: false, completedNow: false },
      { deleted: 400, more: true, completed: false, completedNow: false },
      { deleted: 0, skipped: 0, completed: true, completedNow: false },
    ]) {
      state.run = async () => report(over);
      expect((await post(`Bearer ${SECRET}`)).status).toBe(200);
    }
    expect(revalidated).toEqual([]);
  });

  it("answers 500 with the counts when a subscriber's deletion failed, so the failed job is seen", async () => {
    state.run = async () => report({ failed: 1, completed: false, completedNow: false });
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ deleted: 61, failed: 1, completed: false });
  });

  it("answers 500 with a code, and logs the error's name only, when the run throws", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    state.run = async () => {
      throw new TypeError("connect ECONNREFUSED 10.0.0.1:5432");
    };
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "purge_failed" } });
    const logged = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("10.0.0.1");
  });

  it("is a POST route: a GET is refused", async () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(60);
  });
});
