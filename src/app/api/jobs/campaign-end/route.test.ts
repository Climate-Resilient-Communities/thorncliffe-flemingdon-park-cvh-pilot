import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "9d1f6b3a8c2e4075a1b9c0d3e6f2a8b45c7d9e0f1a3b5c7d2e4f6a8b0c1d3e5f";

// What the composition root does, set by each test. The route is about authentication and the shape of its answers; the job itself is tested against the
// database (test/db/campaign.db.test.ts, "the end").
const state = vi.hoisted(() => ({ run: undefined as undefined | (() => Promise<unknown>), runs: 0, jobSecrets: [] as string[] }));
vi.mock("@/app/campaign", () => ({
  runCampaignEndJob: () => {
    state.runs += 1;
    return (state.run ?? (async () => ({ ended: 2, real: { kept: 140, lapsed: 61 } })))();
  },
}));
vi.mock("@/platform/config/env", () => ({ getEnv: () => ({ jobSecrets: state.jobSecrets }) }));

const { POST, GET, maxDuration, dynamic } = await import("./route");

const post = (authorization?: string) =>
  POST(new Request("https://cvh.example/api/jobs/campaign-end", { method: "POST", headers: authorization === undefined ? {} : { authorization } }));

beforeEach(() => {
  state.run = undefined;
  state.runs = 0;
  state.jobSecrets = [SECRET];
  vi.restoreAllMocks();
});

describe("POST /api/jobs/campaign-end", () => {
  it("refuses a request without the job secret, and runs nothing", async () => {
    for (const header of [undefined, "Bearer nope", `Basic ${SECRET}`]) expect((await post(header)).status).toBe(401);
    expect(state.runs).toBe(0);
  });

  it("answers 503 and runs nothing while no job secret is set", async () => {
    state.jobSecrets = [];
    expect((await post(`Bearer ${SECRET}`)).status).toBe(503);
    expect(state.runs).toBe(0);
  });

  it("runs the job and answers with counts only, never cached", async () => {
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ended: 2, real: { kept: 140, lapsed: 61 } });
    expect(state.runs).toBe(1);
  });

  it("answers 500 with a code, and logs the error's name only, when the run throws", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    state.run = async () => {
      throw new TypeError("connect ECONNREFUSED 10.0.0.1:5432");
    };
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "campaign_end_failed" } });
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
