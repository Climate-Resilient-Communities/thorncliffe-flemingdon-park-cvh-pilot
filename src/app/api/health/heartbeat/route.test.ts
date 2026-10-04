import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HeartbeatCause } from "@/modules/ops";

const reading = vi.fn<() => Promise<{ completedAt: Date | null; fresh: boolean; cause: HeartbeatCause | null }>>();
vi.mock("@/modules/ops", () => ({ readHeartbeat: () => reading() }));
vi.mock("@/platform/db", () => ({ getDb: () => ({}) }));

const { GET, HEAD } = await import("./route");
const { HEARTBEAT_CACHE_MS, cachedHeartbeatStatus, forgetHeartbeatAnswer, heartbeatStatus } = await import("@/app/heartbeat");

const BEATING = { completedAt: new Date(), fresh: true, cause: null };

describe("GET /api/health/heartbeat (S09.01)", () => {
  beforeEach(() => {
    reading.mockReset();
    forgetHeartbeatAnswer();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("answers 200 with nothing else while the health job completed less than 3 minutes ago and nothing it must name holds", async () => {
    reading.mockResolvedValue(BEATING);
    for (const method of [GET, HEAD]) {
      const response = await method();
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect([...response.headers.keys()]).toEqual(["cache-control"]);
    }
  });

  it("answers 503 `health_job_stale` and nothing else when the health job has not completed for 3 minutes, or never has", async () => {
    for (const stale of [{ completedAt: new Date(Date.now() - 200_000), fresh: false }, { completedAt: null, fresh: false }]) {
      reading.mockResolvedValue({ ...stale, cause: "health_job_stale" });
      forgetHeartbeatAnswer();
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.text()).toBe("health_job_stale");
      expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect([...response.headers.keys()].sort()).toEqual(["cache-control", "content-type"]);
    }
  });

  it("answers 503 `provider_auth` while Twilio sign-in keeps failing, with no body on HEAD (S09.01 follow-up)", async () => {
    reading.mockResolvedValue({ ...BEATING, cause: "provider_auth" });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("provider_auth");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const head = await HEAD();
    expect(head.status).toBe(503);
    expect(await head.text()).toBe("");
    expect(head.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 503 `database_unreachable` when the database fails or does not answer in time, and logs the failure by its name only", async () => {
    reading.mockRejectedValue(new TypeError("connect ECONNREFUSED 10.0.0.1:6543 user=cvh_app_login"));
    const response = await GET();
    expect(response.status).toBe(503);
    // The error's text (an address, a role) never reaches the body.
    expect(await response.text()).toBe("database_unreachable");

    const logError = vi.fn();
    expect(await heartbeatStatus({ cause: () => Promise.reject(new TypeError("boom")), logError })).toEqual({ status: 503, cause: "database_unreachable" });
    expect(logError).toHaveBeenCalledWith({ error: "TypeError" });
    expect(await heartbeatStatus({ cause: () => new Promise(() => {}), timeoutMs: 10, logError })).toEqual({ status: 503, cause: "database_unreachable" });
    expect(logError).toHaveBeenLastCalledWith({ error: "HeartbeatTimeout" });
  });

  it("reads the database once for calls within 10 s, shares a read in progress, and reads again after", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    reading.mockResolvedValue(BEATING);

    expect((await GET()).status).toBe(200);
    expect((await HEAD()).status).toBe(200);
    expect(reading).toHaveBeenCalledTimes(1);

    forgetHeartbeatAnswer();
    reading.mockClear();
    expect(await Promise.all([cachedHeartbeatStatus(now), cachedHeartbeatStatus(now)])).toEqual([{ status: 200 }, { status: 200 }]);
    expect(reading).toHaveBeenCalledTimes(1);

    reading.mockResolvedValue({ ...BEATING, cause: "provider_auth" });
    clock += HEARTBEAT_CACHE_MS - 1;
    expect(await cachedHeartbeatStatus(now)).toEqual({ status: 200 });
    expect(reading).toHaveBeenCalledTimes(1);
    clock += 1;
    expect(await cachedHeartbeatStatus(now)).toEqual({ status: 503, cause: "provider_auth" });
    expect(reading).toHaveBeenCalledTimes(2);
  });
});
