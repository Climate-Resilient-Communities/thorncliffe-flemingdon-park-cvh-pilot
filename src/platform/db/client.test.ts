import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../config/env";
import { createDb, getDb, resetDb } from "./client";

const POOLER = "postgres://cvh_app_login.ref:secret@aws-0-ca-central-1.pooler.supabase.com:6543/postgres";

describe("database client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
    resetDb();
  });

  it("turns prepared statements off for the transaction pooler", () => {
    const db = createDb(POOLER);

    expect(db.$client.options.prepare).toBe(false);
  });

  it("connects to DATABASE_URL from the validated environment", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("SMS_MODE", "log");
    vi.stubEnv("PUBLIC_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", POOLER);

    const db = getDb();

    expect(db.$client.options.host).toEqual(["aws-0-ca-central-1.pooler.supabase.com"]);
    expect(db.$client.options.port).toEqual([6543]);
    expect(db.$client.options.prepare).toBe(false);
    expect(getDb()).toBe(db);
  });

  it("fails clearly when DATABASE_URL is not set", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("SMS_MODE", "log");
    vi.stubEnv("PUBLIC_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "");

    expect(() => getDb()).toThrow(/DATABASE_URL is not set/);
  });
});
