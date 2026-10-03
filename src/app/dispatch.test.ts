import { afterEach, describe, expect, it, vi } from "vitest";
import { MESSAGING_OPS_EVENT_KINDS, UNKNOWN_CAUSES, type MessagingLog, type MessagingOpsEvent } from "@/modules/messaging";
import { DELIVERY_UNKNOWN_CAUSES, OPS_EVENT_KINDS, toOpsEventRecord } from "@/modules/ops";
import type { Db, DbExecutor } from "@/platform/db";
import { SenderNotConfigured, appDispatcher, dispatcherConfig, kickDispatcher, opsRecorder, runMessagingServiceCheck, systemClock } from "./dispatch";

const ACCOUNT = `AC${"0".repeat(32)}`;
const SERVICE = `MG${"1".repeat(32)}`;
const DELIVERY = "01900000-0000-7000-8000-0000000d0001";

/** An environment whose Twilio settings throw when read: proof that code which must not read credentials does not. */
function envThatMustNotReadTwilio(smsMode: "log" | "live" = "log") {
  const env = { smsMode, publicBaseUrl: "https://cvh.example", smsSegmentsPerSecond: 3 } as Record<string, unknown>;
  Object.defineProperty(env, "twilio", {
    get() {
      throw new Error("the Twilio credentials were read");
    },
  });
  return env as unknown as Parameters<typeof dispatcherConfig>[0] & { smsSegmentsPerSecond: number };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("where the dispatcher sends", () => {
  it("sends nowhere under SMS_MODE=log, and never reads the Twilio credentials", () => {
    expect(dispatcherConfig(envThatMustNotReadTwilio("log"))).toEqual({ mode: "log" });
    // Building the whole dispatcher under log mode reads none either.
    const dispatcher = appDispatcher({
      env: envThatMustNotReadTwilio("log"),
      db: {} as Db,
      resolver: { resolve: async () => ({ found: false, reason: "recipient_gone" }) },
      alerts: { standingOf: async () => null },
      ops: { record: async () => undefined },
      log: { info: () => undefined, error: () => undefined },
    });
    expect(typeof dispatcher.run).toBe("function");
  });

  it("sends through the Messaging Service under SMS_MODE=live, with the account's credentials and the public base URL", () => {
    const config = dispatcherConfig({
      smsMode: "live",
      publicBaseUrl: "https://cvh.example",
      twilio: { accountSid: ACCOUNT, authToken: "fake-token", messagingServiceSid: SERVICE },
    });
    expect(config).toMatchObject({ mode: "live", messagingServiceSid: SERVICE, publicBaseUrl: "https://cvh.example" });
    expect(config.mode === "live" && typeof config.submitter.submit).toBe("function");
  });

  it("refuses to run, naming the rule and never a value, where live sending is not set up, so no row is claimed that could not be sent", () => {
    expect(() => dispatcherConfig({ smsMode: "live", publicBaseUrl: "https://cvh.example", twilio: undefined })).toThrow(SenderNotConfigured);
    expect(() => dispatcherConfig({ smsMode: "live", publicBaseUrl: "https://cvh.example", twilio: { accountSid: ACCOUNT, authToken: "secret-token" } })).toThrow(/TWILIO_MESSAGING_SERVICE_SID is not set/);
    try {
      dispatcherConfig({ smsMode: "live", publicBaseUrl: "https://cvh.example", twilio: { accountSid: ACCOUNT, authToken: "secret-token" } });
    } catch (error) {
      expect((error as Error).message).not.toContain("secret-token");
      expect((error as SenderNotConfigured).rule).toBe("TWILIO_MESSAGING_SERVICE_SID is not set");
    }
  });

  it("uses the real clock, whose skew from the database is none (the database decides, with its own now())", () => {
    expect(systemClock.skewMs()).toBe(0);
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1000);
  });
});

describe("starting the dispatcher right after an approval commits", () => {
  it("schedules the run after the response and returns at once, whatever the run does", async () => {
    let task: (() => Promise<void>) | undefined;
    const run = vi.fn(async () => ({}) as never);
    expect(kickDispatcher(run, (scheduled) => void (task = scheduled))).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
    await task!();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never throws: a failed run is logged by its error's name only", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let task: (() => Promise<void>) | undefined;
    kickDispatcher(
      async () => {
        throw new Error("connect failed for +14165550123");
      },
      (scheduled) => void (task = scheduled),
    );
    await expect(task!()).resolves.toBeUndefined();
    const logged = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("dispatch.kick_failed");
    expect(logged).not.toContain("5550123");
  });

  it("starts the run at once where no request is under way (there is no `after` outside one)", async () => {
    const run = vi.fn(async () => ({}) as never);
    kickDispatcher(run);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("messaging's operational events in ops_event", () => {
  /** An executor that keeps the rows ops would insert. */
  const recorder = () => {
    const rows: Record<string, unknown>[] = [];
    const executor = { insert: () => ({ values: async (row: Record<string, unknown>) => void rows.push(row) }) } as unknown as DbExecutor;
    return { rows, executor };
  };

  const events: MessagingOpsEvent[] = [
    { kind: "delivery.unknown", deliveryId: DELIVERY, detail: { cause: "server_error", http_status: 503 } },
    { kind: "delivery.unknown", deliveryId: DELIVERY, detail: { cause: "no_outcome_after_hand_off" } },
    { kind: "dispatch.provider_auth_failed", detail: { http_status: 401 } },
    { kind: "messaging.smart_encoding_on", detail: {} },
    { kind: "messaging.service_check_failed", detail: { reason: "http_404" } },
  ];

  it("has an ops event for every kind messaging can record, and records each as the ops module defines it", async () => {
    expect([...new Set(events.map((event) => event.kind))].sort()).toEqual([...MESSAGING_OPS_EVENT_KINDS].sort());
    for (const kind of MESSAGING_OPS_EVENT_KINDS) expect(Object.keys(OPS_EVENT_KINDS), kind).toContain(kind);
    const { rows, executor } = recorder();
    for (const event of events) await opsRecorder.record(executor, event);
    expect(rows).toEqual([
      { kind: "delivery.unknown", severity: "error", subjectType: "delivery", subjectId: DELIVERY, detail: { cause: "server_error", http_status: 503 } },
      { kind: "delivery.unknown", severity: "error", subjectType: "delivery", subjectId: DELIVERY, detail: { cause: "no_outcome_after_hand_off" } },
      { kind: "dispatch.provider_auth_failed", severity: "error", subjectType: null, subjectId: null, detail: { http_status: 401 } },
      { kind: "messaging.smart_encoding_on", severity: "error", subjectType: null, subjectId: null, detail: {} },
      { kind: "messaging.service_check_failed", severity: "warning", subjectType: null, subjectId: null, detail: { reason: "http_404" } },
    ]);
  });

  it("knows the same causes of an unknown text as messaging does (ops may not import messaging's domain, so a test holds the two lists together)", () => {
    expect([...DELIVERY_UNKNOWN_CAUSES].sort()).toEqual([...UNKNOWN_CAUSES].sort());
    for (const cause of UNKNOWN_CAUSES) {
      expect(() => toOpsEventRecord({ kind: "delivery.unknown", subjectType: "delivery", subjectId: DELIVERY, detail: { cause } }), cause).not.toThrow();
    }
  });

  it("refuses an event with a field outside its schema, so personal data has nowhere to go", () => {
    expect(() => toOpsEventRecord({ kind: "delivery.unknown", detail: { cause: "timeout", phone: "+14165550123" } as never })).toThrow();
    expect(() => toOpsEventRecord({ kind: "delivery.unknown", detail: { cause: "the provider hung up" } as never })).toThrow();
  });
});

describe("the daily Messaging Service check", () => {
  const log: MessagingLog = { info: () => undefined, error: () => undefined };
  const live = { smsMode: "live" as const, twilio: { accountSid: ACCOUNT, authToken: "fake-token", messagingServiceSid: SERVICE } };

  /** The Messaging API, faked: the service's Smart Encoding setting as given. */
  function stubService(smartEncoding: boolean) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sid: SERVICE, smart_encoding: smartEncoding }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("reads nothing outside production: under SMS_MODE=log there is no Twilio account to ask", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = envThatMustNotReadTwilio("log") as unknown as Parameters<typeof runMessagingServiceCheck>[0] extends infer P ? (P extends { env?: infer E } ? E : never) : never;
    await expect(runMessagingServiceCheck({ env, db: {} as Db, log })).resolves.toEqual({ status: "not_live" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records nothing when Smart Encoding is off, and raises ops_event messaging.smart_encoding_on when it is on", async () => {
    const recorded: MessagingOpsEvent[] = [];
    const ops = { record: async (_executor: DbExecutor, event: MessagingOpsEvent) => void recorded.push(event) };
    const off = stubService(false);
    await expect(runMessagingServiceCheck({ env: live, db: {} as Db, log, ops })).resolves.toEqual({ status: "smart_encoding_off" });
    expect(off).toHaveBeenCalledTimes(1);
    expect(recorded).toEqual([]);

    stubService(true);
    await expect(runMessagingServiceCheck({ env: live, db: {} as Db, log, ops })).resolves.toEqual({ status: "smart_encoding_on" });
    expect(recorded).toEqual([{ kind: "messaging.smart_encoding_on", detail: {} }]);
  });

  it("refuses to check where the Messaging Service is not set up", async () => {
    await expect(runMessagingServiceCheck({ env: { smsMode: "live", twilio: undefined }, db: {} as Db, log })).rejects.toThrow(SenderNotConfigured);
    await expect(runMessagingServiceCheck({ env: { smsMode: "live", twilio: { accountSid: ACCOUNT, authToken: "t" } }, db: {} as Db, log })).rejects.toThrow(/TWILIO_MESSAGING_SERVICE_SID/);
  });
});
