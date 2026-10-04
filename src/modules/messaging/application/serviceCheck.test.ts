import { describe, expect, it } from "vitest";
import type { Db } from "../../../platform/db";
import type { MessagingLog } from "./deliveryPorts";
import type { AbuseSettingsReading, MessagingOpsEvent, MessagingServiceReader, SmartEncodingReading } from "./dispatcherPorts";
import { createMessagingServiceCheck } from "./serviceCheck";

const SERVICE = `MG${"1".repeat(32)}`;
const db = {} as Db;

const RIGHT: AbuseSettingsReading = { kind: "read", geoCanadaOnly: true, pumpingProtection: true };

function check(reading: SmartEncodingReading, settings: AbuseSettingsReading = RIGHT) {
  const asked: string[] = [];
  const events: MessagingOpsEvent[] = [];
  const lines: { level: string; evt: string; fields: Record<string, unknown> }[] = [];
  const reader: MessagingServiceReader = {
    async readSmartEncoding(sid) {
      asked.push(sid);
      return reading;
    },
    async readAbuseSettings(sid) {
      asked.push(sid);
      return settings;
    },
  };
  const log: MessagingLog = { info: (evt, fields) => void lines.push({ level: "info", evt, fields }), error: (evt, fields) => void lines.push({ level: "error", evt, fields }) };
  const service = createMessagingServiceCheck({ db, reader, messagingServiceSid: SERVICE, ops: { record: async (_executor, event) => void events.push(event) }, log });
  return { service, asked, events, lines };
}

describe("the Messaging Service check", () => {
  it("reads the service's Smart Encoding setting and, when it is off, records that it was found off (the health job's recovery) and logs that it checked", async () => {
    const { service, asked, events, lines } = check({ kind: "read", smartEncoding: false });
    await expect(service.run()).resolves.toEqual({ status: "smart_encoding_off", settings: "right" });
    expect(asked).toEqual([SERVICE, SERVICE]);
    expect(events).toEqual([
      { kind: "messaging.smart_encoding_off", detail: {} },
      { kind: "messaging.service_settings_ok", detail: {} },
    ]);
    expect(lines).toEqual([
      { level: "info", evt: "messaging_service.checked", fields: { smart_encoding: false } },
      { level: "info", evt: "messaging_service.settings_checked", fields: { geo_canada_only: true, pumping_protection: true } },
    ]);
  });

  it("raises an ops_event of severity error, for the on-call alert, when Smart Encoding is on", async () => {
    const { service, events, lines } = check({ kind: "read", smartEncoding: true });
    await expect(service.run()).resolves.toEqual({ status: "smart_encoding_on", settings: "right" });
    expect(events[0]).toEqual({ kind: "messaging.smart_encoding_on", detail: {} });
    expect(lines.map((line) => [line.level, line.evt])[0]).toEqual(["error", "messaging_service.smart_encoding_on"]);
  });

  it("does not take a setting it could not read for 'off': it records that the check failed, with a code", async () => {
    const { service, events, lines } = check({ kind: "unreadable", reason: "http_401" });
    await expect(service.run()).resolves.toMatchObject({ status: "unreadable", reason: "http_401" });
    expect(events[0]).toEqual({ kind: "messaging.service_check_failed", detail: { reason: "http_401" } });
    expect(lines.map((line) => line.evt)[0]).toBe("messaging_service.check_failed");
  });

  describe("geo permissions and SMS pumping protection (S07.09)", () => {
    const OFF: SmartEncodingReading = { kind: "read", smartEncoding: false };

    it.each([
      ["geo permissions allow more than Canada", { kind: "read", geoCanadaOnly: false, pumpingProtection: true }, { geo_not_canada_only: true, pumping_protection_off: false }],
      ["SMS pumping protection is off", { kind: "read", geoCanadaOnly: true, pumpingProtection: false }, { geo_not_canada_only: false, pumping_protection_off: true }],
      ["both are wrong", { kind: "read", geoCanadaOnly: false, pumpingProtection: false }, { geo_not_canada_only: true, pumping_protection_off: true }],
    ] as const)("raises messaging.service_settings_wrong, severity error and so the on-call alert, when %s", async (_name, settings, detail) => {
      const { service, events, lines } = check(OFF, settings);
      await expect(service.run()).resolves.toEqual({
        status: "smart_encoding_off",
        settings: "wrong",
        geoNotCanadaOnly: detail.geo_not_canada_only,
        pumpingProtectionOff: detail.pumping_protection_off,
      });
      expect(events.at(-1)).toEqual({ kind: "messaging.service_settings_wrong", detail });
      expect(events.some((event) => event.kind === "messaging.service_settings_ok")).toBe(false);
      expect(lines.at(-1)).toEqual({ level: "error", evt: "messaging_service.settings_wrong", fields: detail });
    });

    it("does not take a protection it could not read for right: it records that the check failed, with a code", async () => {
      const { service, events } = check(OFF, { kind: "unreadable", reason: "pumping_setting_missing" });
      await expect(service.run()).resolves.toEqual({ status: "smart_encoding_off", settings: "unreadable", reason: "pumping_setting_missing" });
      expect(events.at(-1)).toEqual({ kind: "messaging.service_check_failed", detail: { reason: "pumping_setting_missing" } });
      expect(events.some((event) => event.kind === "messaging.service_settings_ok")).toBe(false);
    });
  });
});
