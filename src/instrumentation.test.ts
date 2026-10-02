import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";
import { resetEnvCache } from "./platform/config/env";

const unsafe = { VERCEL_ENV: "preview", SMS_MODE: "live", PUBLIC_BASE_URL: "https://cvh-preview.vercel.app" };
const safeLocal = { SMS_MODE: "log", PUBLIC_BASE_URL: "http://localhost:3000" };

function stub(vars: Record<string, string>) {
  for (const name of ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "NEXT_PHASE", "SMS_MODE", "PUBLIC_BASE_URL"]) {
    vi.stubEnv(name, "");
  }
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
}

describe("register (start-up check)", () => {
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    resetEnvCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetEnvCache();
  });

  it("stops the Node.js server with exit code 1 on an unsafe environment", async () => {
    stub({ NEXT_RUNTIME: "nodejs", ...unsafe });
    await register();
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("SMS_MODE"));
  });

  it("checks outside Vercel too (local next start or next dev)", async () => {
    stub({ NEXT_RUNTIME: "nodejs", SMS_MODE: "live", PUBLIC_BASE_URL: "http://localhost:3000" });
    await register();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("starts with a safe environment", async () => {
    stub({ NEXT_RUNTIME: "nodejs", ...safeLocal });
    await register();
    expect(exit).not.toHaveBeenCalled();
  });

  it("does nothing during next build or in the edge runtime", async () => {
    stub({ NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-build", ...unsafe });
    await register();
    stub({ NEXT_RUNTIME: "edge", ...unsafe });
    await register();
    expect(exit).not.toHaveBeenCalled();
  });
});
