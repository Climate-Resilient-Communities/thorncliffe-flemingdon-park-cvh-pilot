import { beforeEach, describe, expect, it, vi } from "vitest";

const fresh = vi.fn<() => Promise<{ completedAt: Date | null; fresh: boolean }>>();
vi.mock("@/modules/ops", () => ({ readHeartbeat: () => fresh() }));
vi.mock("@/platform/db", () => ({ getDb: () => ({}) }));

const { GET, HEAD } = await import("./route");
const { heartbeatStatus } = await import("@/app/heartbeat");

describe("GET /api/health/heartbeat (S09.01)", () => {
  beforeEach(() => {
    fresh.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("answers 200 with nothing else while the health job completed less than 3 minutes ago", async () => {
    fresh.mockResolvedValue({ completedAt: new Date(), fresh: true });
    for (const method of [GET, HEAD]) {
      const response = await method();
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect([...response.headers.keys()]).toEqual(["cache-control"]);
    }
  });

  it("answers 503 with nothing else when the health job has not completed for 3 minutes, or never has", async () => {
    for (const reading of [{ completedAt: new Date(Date.now() - 200_000), fresh: false }, { completedAt: null, fresh: false }]) {
      fresh.mockResolvedValue(reading);
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.text()).toBe("");
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect([...response.headers.keys()]).toEqual(["cache-control"]);
    }
  });

  it("answers 503 when the database fails or does not answer in time, and logs the failure by its name only", async () => {
    fresh.mockRejectedValue(new TypeError("connect ECONNREFUSED 10.0.0.1:6543 user=cvh_app_login"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");

    const logError = vi.fn();
    expect(await heartbeatStatus({ fresh: () => Promise.reject(new TypeError("boom")), logError })).toBe(503);
    expect(logError).toHaveBeenCalledWith({ error: "TypeError" });
    expect(await heartbeatStatus({ fresh: () => new Promise(() => {}), timeoutMs: 10, logError })).toBe(503);
    expect(logError).toHaveBeenLastCalledWith({ error: "HeartbeatTimeout" });
  });
});
