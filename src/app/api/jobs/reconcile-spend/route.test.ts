import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "9d1f6b3a8c2e4075a1b9c0d3e6f2a8b45c7d9e0f1a3b5c7d2e4f6a8b0c1d3e5f";

const state = vi.hoisted(() => ({ run: undefined as undefined | ((input: { months?: readonly string[] }) => Promise<unknown>), inputs: [] as unknown[], jobSecrets: [] as string[] }));
vi.mock("@/app/dispatch", () => {
  class SenderNotConfigured extends Error {
    constructor(readonly rule: string) {
      super(rule);
      this.name = "SenderNotConfigured";
    }
  }
  return { SenderNotConfigured };
});
vi.mock("@/app/reconcile", () => ({
  runReconcileJob: (input: { months?: readonly string[] }) => {
    state.inputs.push(input);
    return (state.run ?? (async () => ({ status: "ok", results: [{ id: "month:2026-09", result: { status: "already_complete" } }] })))(input);
  },
}));
vi.mock("@/platform/config/env", () => ({ getEnv: () => ({ jobSecrets: state.jobSecrets }) }));

const { POST, GET } = await import("./route");
const { SenderNotConfigured } = await import("@/app/dispatch");

const post = (authorization?: string, body?: string) =>
  POST(new Request("https://cvh.example/api/jobs/reconcile-spend", { method: "POST", headers: authorization === undefined ? {} : { authorization }, body }));

beforeEach(() => {
  state.run = undefined;
  state.inputs.length = 0;
  state.jobSecrets = [SECRET];
  vi.restoreAllMocks();
});

describe("POST /api/jobs/reconcile-spend (S06.08)", () => {
  it("needs the job secret, and reconciles nothing without it", async () => {
    expect((await post()).status).toBe(401);
    expect((await post("Bearer nope")).status).toBe(401);
    state.jobSecrets = [];
    expect((await post(`Bearer ${SECRET}`)).status).toBe(503);
    expect(state.inputs).toEqual([]);
  });

  it("with no body reconciles what is due, and answers each month's result, not cacheable", async () => {
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", results: [{ id: "month:2026-09", result: { status: "already_complete" } }] });
    expect(state.inputs).toEqual([{ months: undefined }]);
    // A blank body is no body.
    await post(`Bearer ${SECRET}`, "  ");
    expect(state.inputs[1]).toEqual({ months: undefined });
  });

  it("reconciles the month it is asked for", async () => {
    await post(`Bearer ${SECRET}`, JSON.stringify({ month: "2026-10" }));
    expect(state.inputs).toEqual([{ months: ["2026-10"] }]);
  });

  it("refuses a body that is not JSON, and a month that is not YYYY-MM, before it runs anything", async () => {
    const notJson = await post(`Bearer ${SECRET}`, "month=2026-10");
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ error: { code: "body_invalid" } });
    for (const body of [{ month: "2026-13" }, { month: "2026-1" }, { month: 202610 }, { months: ["2026-10"] }, {}, [], "2026-10", null]) {
      const response = await post(`Bearer ${SECRET}`, JSON.stringify(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "month_invalid" } });
    }
    expect(state.inputs).toEqual([]);
  });

  it("says not_live outside production, where there is no Twilio account and nothing is read", async () => {
    state.run = async () => ({ status: "not_live" });
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "not_live" });
  });

  it("answers a month that is pending or not ended as a result, not an error: the next run tries again", async () => {
    state.run = async () => ({ status: "ok", results: [{ id: "month:2026-09", result: { status: "pending", reason: "message_without_price" } }, { id: "month:2026-10", result: { status: "not_ended", endsAt: "2026-11-01T04:00:00.000Z" } }] });
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ results: [{ result: { status: "pending" } }, { result: { status: "not_ended" } }] });
  });

  it("answers 500, with the results, when a month failed (a database error), so the failure is seen", async () => {
    state.run = async () => ({ status: "ok", results: [{ id: "month:2026-09", result: { status: "failed", error: "PostgresError" } }] });
    const response = await post(`Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "reconcile_failed" }, status: "ok", results: [{ id: "month:2026-09", result: { status: "failed", error: "PostgresError" } }] });
  });

  it("answers 503 where Twilio's account is not set up, and 500 for any other failure, with no detail in the answer or the log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    state.run = async () => {
      throw new SenderNotConfigured("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are not set");
    };
    const notSet = await post(`Bearer ${SECRET}`);
    expect(notSet.status).toBe(503);
    expect(await notSet.json()).toEqual({ error: { code: "sender_not_configured" } });
    state.run = async () => {
      throw new Error("boom +14165550123 token abc");
    };
    const failed = await post(`Bearer ${SECRET}`);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: { code: "reconcile_failed" } });
    expect(log.mock.calls.map((call) => String(call[0])).join("\n")).not.toMatch(/5550123|token abc/);
  });

  it("is a POST only", () => {
    expect(GET().status).toBe(405);
    expect(state.inputs).toEqual([]);
  });
});
