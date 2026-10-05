import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "9d1f6b3a8c2e4075a1b9c0d3e6f2a8b45c7d9e0f1a3b5c7d2e4f6a8b0c1d3e5f";

const state = vi.hoisted(() => ({ check: undefined as undefined | (() => Promise<unknown>), checks: 0, jobSecrets: [] as string[] }));
vi.mock("@/app/dispatch", () => {
  class SenderNotConfigured extends Error {
    constructor(readonly rule: string) {
      super(rule);
      this.name = "SenderNotConfigured";
    }
  }
  return {
    SenderNotConfigured,
    runMessagingServiceCheck: () => {
      state.checks += 1;
      return (state.check ?? (async () => ({ status: "smart_encoding_off" })))();
    },
  };
});
vi.mock("@/platform/config/env", () => ({ getEnv: () => ({ jobSecrets: state.jobSecrets }) }));

const { POST, GET } = await import("./route");
const { SenderNotConfigured } = await import("@/app/dispatch");

const post = (authorization?: string) => POST(new Request("https://cvh.example/api/jobs/messaging-config", { method: "POST", headers: authorization === undefined ? {} : { authorization } }));

beforeEach(() => {
  state.check = undefined;
  state.checks = 0;
  state.jobSecrets = [SECRET];
  vi.restoreAllMocks();
});

describe("POST /api/jobs/messaging-config", () => {
  it("needs the job secret, and checks nothing without it", async () => {
    expect((await post()).status).toBe(401);
    expect((await post("Bearer nope")).status).toBe(401);
    state.jobSecrets = [];
    expect((await post(`Bearer ${SECRET}`)).status).toBe(503);
    expect(state.checks).toBe(0);
  });

  it("returns what the check found, not cacheable", async () => {
    for (const status of ["smart_encoding_off", "smart_encoding_on", "not_live"]) {
      state.check = async () => ({ status, settings: "right" });
      const response = await post(`Bearer ${SECRET}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ status, settings: "right" });
    }
    state.check = async () => ({ status: "unreadable", reason: "http_404" });
    expect(await (await post(`Bearer ${SECRET}`)).json()).toEqual({ status: "unreadable", reason: "http_404" });
  });

  it("answers 503 where the Messaging Service is not set up, and 500 for any other failure, with no detail in the answer", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    state.check = async () => {
      throw new SenderNotConfigured("TWILIO_MESSAGING_SERVICE_SID is not set");
    };
    const notSet = await post(`Bearer ${SECRET}`);
    expect(notSet.status).toBe(503);
    expect(await notSet.json()).toEqual({ error: { code: "sender_not_configured" } });
    state.check = async () => {
      throw new Error("boom +14165550123");
    };
    const failed = await post(`Bearer ${SECRET}`);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: { code: "check_failed" } });
    expect(log.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain("5550123");
  });

  it("is a POST only", () => {
    expect(GET().status).toBe(405);
    expect(state.checks).toBe(0);
  });
});
