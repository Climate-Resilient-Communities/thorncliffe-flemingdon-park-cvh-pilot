import { describe, expect, it } from "vitest";
import type { Db } from "../../../platform/db";
import type { MessagingLog } from "./deliveryPorts";
import type { MessagingOpsEvent, MessagingServiceReader, SmartEncodingReading } from "./dispatcherPorts";
import { createMessagingServiceCheck } from "./serviceCheck";

const SERVICE = `MG${"1".repeat(32)}`;
const db = {} as Db;

function check(reading: SmartEncodingReading) {
  const asked: string[] = [];
  const events: MessagingOpsEvent[] = [];
  const lines: { level: string; evt: string; fields: Record<string, unknown> }[] = [];
  const reader: MessagingServiceReader = {
    async readSmartEncoding(sid) {
      asked.push(sid);
      return reading;
    },
  };
  const log: MessagingLog = { info: (evt, fields) => void lines.push({ level: "info", evt, fields }), error: (evt, fields) => void lines.push({ level: "error", evt, fields }) };
  const service = createMessagingServiceCheck({ db, reader, messagingServiceSid: SERVICE, ops: { record: async (_executor, event) => void events.push(event) }, log });
  return { service, asked, events, lines };
}

describe("the Messaging Service check", () => {
  it("reads the service's Smart Encoding setting and, when it is off, only logs that it checked", async () => {
    const { service, asked, events, lines } = check({ kind: "read", smartEncoding: false });
    await expect(service.run()).resolves.toEqual({ status: "smart_encoding_off" });
    expect(asked).toEqual([SERVICE]);
    expect(events).toEqual([]);
    expect(lines).toEqual([{ level: "info", evt: "messaging_service.checked", fields: { smart_encoding: false } }]);
  });

  it("raises an ops_event of severity error, for the on-call alert, when Smart Encoding is on", async () => {
    const { service, events, lines } = check({ kind: "read", smartEncoding: true });
    await expect(service.run()).resolves.toEqual({ status: "smart_encoding_on" });
    expect(events).toEqual([{ kind: "messaging.smart_encoding_on", detail: {} }]);
    expect(lines.map((line) => [line.level, line.evt])).toEqual([["error", "messaging_service.smart_encoding_on"]]);
  });

  it("does not take a setting it could not read for 'off': it records that the check failed, with a code", async () => {
    const { service, events, lines } = check({ kind: "unreadable", reason: "http_401" });
    await expect(service.run()).resolves.toEqual({ status: "unreadable", reason: "http_401" });
    expect(events).toEqual([{ kind: "messaging.service_check_failed", detail: { reason: "http_401" } }]);
    expect(lines.map((line) => line.evt)).toEqual(["messaging_service.check_failed"]);
  });
});
