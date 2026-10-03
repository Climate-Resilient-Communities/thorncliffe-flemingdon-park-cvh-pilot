import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "9d1f6b3a8c2e4075a1b9c0d3e6f2a8b45c7d9e0f1a3b5c7d2e4f6a8b0c1d3e5f";

// What the composition root does, set by each test. The route is about authentication and the shape of its answers; the dispatcher
// itself is tested against the database.
const state = vi.hoisted(() => ({ run: undefined as undefined | (() => Promise<unknown>), runs: 0, jobSecrets: [] as string[] }));
vi.mock("@/app/dispatch", () => {
  class SenderNotConfigured extends Error {
    constructor(readonly rule: string) {
      super(rule);
      this.name = "SenderNotConfigured";
    }
  }
  return {
    SenderNotConfigured,
    runDispatchJob: () => {
      state.runs += 1;
      return (state.run ?? (async () => ({})))();
    },
  };
});
vi.mock("@/platform/config/env", () => ({ getEnv: () => ({ jobSecrets: state.jobSecrets }) }));

const { POST, GET, maxDuration, dynamic } = await import("./route");
const { SenderNotConfigured } = await import("@/app/dispatch");

const post = (authorization?: string) => POST(new Request("https://cvh.example/api/jobs/dispatch", { method: "POST", headers: authorization === undefined ? {} : { authorization } }));
const REPORT = { status: "ok", claimed: 3, handedOff: 3, submitted: 3, requeued: 0, failed: 0, unknown: 0, skippedEnv: 0, stopped: 0, segments: 3, sweep: { requeued: 0, unknown: 0 } };

beforeEach(() => {
  state.run = undefined;
  state.runs = 0;
  state.jobSecrets = [SECRET];
  vi.restoreAllMocks();
});

describe("POST /api/jobs/dispatch", () => {
  it("refuses a request without the job secret, and runs nothing", async () => {
    for (const header of [undefined, "Bearer nope", `Basic ${SECRET}`]) {
      const response = await post(header);
      expect(response.status, String(header)).toBe(401);
    }
    expect(state.runs).toBe(0);
  });

  it("answers 503 and runs nothing while no job secret is configured, even for a request that sends one", async () => {
    state.jobSecrets = [];
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("jobs_not_configured");
    expect(state.runs).toBe(0);
  });

  it("runs the dispatcher for the secret and returns its report: counts and a status, never a number or a body, and not cacheable", async () => {
    state.run = async () => REPORT;
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(REPORT);
    expect(state.runs).toBe(1);
  });

  it("accepts the previous secret during a rotation", async () => {
    const previous = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809";
    state.jobSecrets = [SECRET, previous];
    state.run = async () => REPORT;
    expect((await post(`Bearer ${previous}`)).status).toBe(200);
  });

  it("answers 503 sender_not_configured where live sending is not set up, naming the rule in the log and not in the answer", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    state.run = async () => {
      throw new SenderNotConfigured("TWILIO_MESSAGING_SERVICE_SID is not set");
    };
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "sender_not_configured" } });
    expect(String(log.mock.calls[0][0])).toContain("TWILIO_MESSAGING_SERVICE_SID is not set");
  });

  it("answers 500 for any other failure, with the error's name in the log and nothing of it in the answer", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    state.run = async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.9:6543 for +14165550123");
    };
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "dispatch_failed" } });
    const logged = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("dispatch.run_failed");
    expect(logged).not.toContain("5550123");
    expect(logged).not.toContain("10.0.0.9");
  });

  it("is a POST only: a GET is refused and runs nothing", async () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(state.runs).toBe(0);
  });

  it("is never cached and may run for a minute (the run plans its sends to end 10 seconds before)", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(60);
  });
});
