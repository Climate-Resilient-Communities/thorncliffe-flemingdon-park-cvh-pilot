import { afterEach, describe, expect, it, vi } from "vitest";
import type { SmsMessageLister } from "@/modules/spend";
import type { Db } from "@/platform/db";
import { SenderNotConfigured } from "./dispatch";
import { appSmsReconciler, runReconcileJob } from "./reconcile";

const getDb = vi.hoisted(() => vi.fn(() => {
  throw new Error("the database was asked for");
}));
vi.mock("@/platform/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/platform/db")>()), getDb }));
vi.mock("@/platform/config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/platform/config/env")>()),
  getEnv: () => ({ smsMode: "log", smsUsdToCadRate: 1.4 }),
}));

const ACCOUNT = `AC${"0".repeat(32)}`;
const silent = { info: () => undefined, error: () => undefined };

/** An environment whose Twilio settings throw when read: proof that code which must not read credentials does not. */
function envThatMustNotReadTwilio(smsMode: "log" | "live" = "log") {
  const env = { smsMode, smsUsdToCadRate: 1.4 } as Record<string, unknown>;
  Object.defineProperty(env, "twilio", {
    get() {
      throw new Error("the Twilio credentials were read");
    },
  });
  return env as unknown as NonNullable<Parameters<typeof appSmsReconciler>[0]>["env"];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  getDb.mockClear();
});

describe("the reconciliation of the app (S06.08)", () => {
  it("lists nothing, reads no Twilio credential and touches no database outside production (SMS_MODE=log): there is no Twilio account to ask", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(appSmsReconciler({ env: envThatMustNotReadTwilio("log") })).toBeNull();
    await expect(runReconcileJob({}, { env: envThatMustNotReadTwilio("log") })).resolves.toEqual({ status: "not_live" });
    // The default environment is the validated one: log mode here too.
    await expect(runReconcileJob()).resolves.toEqual({ status: "not_live" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses to run, naming the rule and never a value, where live is set and Twilio's account is not", () => {
    const env = { smsMode: "live", twilio: undefined, smsUsdToCadRate: 1.4 } as const;
    expect(() => appSmsReconciler({ env, db: {} as Db })).toThrow(SenderNotConfigured);
    expect(() => appSmsReconciler({ env, db: {} as Db })).toThrow(/TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are not set/);
  });

  it("builds Twilio's listing under live with the account's credentials, and calls nothing until a reconciliation lists", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const reconciler = appSmsReconciler({ env: { smsMode: "live", twilio: { accountSid: ACCOUNT, authToken: "fake-token" }, smsUsdToCadRate: 1.4 }, db: {} as Db, log: silent });
    expect(typeof reconciler?.reconcile).toBe("function");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes the listing a test gives it (a fake) in any environment, and never builds the real one", async () => {
    const fake: SmsMessageLister = { first: vi.fn(), next: vi.fn() };
    const result = await runReconcileJob(
      { months: ["2026-13", "2999-01"] },
      { env: envThatMustNotReadTwilio("log"), lister: fake, db: {} as Db, now: () => new Date("2026-11-02T11:30:00Z"), log: silent },
    );
    // An id that is not a month is refused, and a month that has not ended is not listed: the fake and the (absent) database are never asked.
    expect(result).toEqual({
      status: "ok",
      results: [
        { id: "month:2026-13", result: { status: "refused", reason: "id_invalid" } },
        { id: "month:2999-01", result: { status: "not_ended", endsAt: "2999-02-01T05:00:00.000Z" } },
      ],
    });
    expect(fake.first).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });
});
