// The Messaging Service's configuration check (S06.02, AD-21; S07.09, AD-22): the frozen body is sent byte for byte, so Smart Encoding (which
// replaces characters it thinks are the same) must be off on the Twilio Messaging Service. Every request already sets
// `SmartEncoded=false`; this is defence in depth, run daily by the health job and on every change to the service that the
// procedures record. It reads the one setting and, when it is on, records `messaging.smart_encoding_on` in ops_event (the
// health job turns it into the on-call alert, S06.07). It changes nothing in Twilio, and it never reads a number or a body.
//
// From S07.09 the same daily check also reads the service's two protections against abuse: geo permissions must allow Canada only and SMS
// pumping protection must be on. When either is not, it records `messaging.service_settings_wrong` (which of the two, as flags), which the health
// job turns into the on-call alert (condition `messaging_settings`); when both are right it records `messaging.service_settings_ok`, the end of an
// earlier finding. A setting it cannot read is a `messaging.service_check_failed` warning (with `check` saying which read) and also counts as `messaging.service_settings_wrong` with `unreadable: true`: never taken for "right", never quieter than wrong.
//
// Configuration control (the procedures state it, S09.03): only named Admins change the Messaging Service, and texts are paused
// while they do, so a setting changed by hand is never live while texts are going out.
import type { Db } from "../../../platform/db";
import type { MessagingLog } from "./deliveryPorts";
import type { AbuseSettingsReading, MessagingServiceReader, OpsRecorder, SmartEncodingReading } from "./dispatcherPorts";

export type ServiceCheckResult =
  /** Smart Encoding is off, as it must be. */
  | { status: "smart_encoding_off" }
  /** Smart Encoding is on: recorded as an ops_event with severity error. */
  | { status: "smart_encoding_on" }
  /** The setting could not be read (a code, never a message): recorded as a warning, so a silent failure is not mistaken for "off". */
  | { status: "unreadable"; reason: string };

/** What the check found of the abuse protections. */
export type SettingsCheckResult = { settings: "right" } | { settings: "wrong"; geoNotCanadaOnly: boolean; pumpingProtectionOff: boolean } | { settings: "unreadable"; reason: string };

/** The two findings, nested so neither hides the other's reason. */
export interface ServiceCheckFinding {
  encoding: ServiceCheckResult;
  settings: SettingsCheckResult;
}

export interface MessagingServiceCheckDeps {
  db: Db;
  reader: MessagingServiceReader;
  messagingServiceSid: string;
  ops: OpsRecorder;
  log: MessagingLog;
}

export interface MessagingServiceCheck {
  run(): Promise<ServiceCheckFinding>;
}

export function createMessagingServiceCheck(deps: MessagingServiceCheckDeps): MessagingServiceCheck {
  const { db, reader, messagingServiceSid, ops, log } = deps;

  async function checkSmartEncoding(reading: SmartEncodingReading): Promise<ServiceCheckResult> {
    if (reading.kind === "unreadable") {
      await ops.record(db, { kind: "messaging.service_check_failed", detail: { reason: reading.reason, check: "smart_encoding" } });
      log.error("messaging_service.check_failed", { reason: reading.reason });
      return { status: "unreadable", reason: reading.reason };
    }
    if (reading.smartEncoding) {
      await ops.record(db, { kind: "messaging.smart_encoding_on", detail: {} });
      log.error("messaging_service.smart_encoding_on", {});
      return { status: "smart_encoding_on" };
    }
    // The check found it off: recorded so the health job can tell that an earlier "on" has been put right (S06.07).
    // A failure to record it is logged and does not fail the check, which found what it was asked for.
    await ops.record(db, { kind: "messaging.smart_encoding_off", detail: {} }).catch((error: unknown) => {
      log.error("messaging_service.off_not_recorded", { error: error instanceof Error ? error.name : "NonError" });
    });
    log.info("messaging_service.checked", { smart_encoding: false });
    return { status: "smart_encoding_off" };
  }

  async function checkSettings(reading: AbuseSettingsReading): Promise<SettingsCheckResult> {
    if (reading.kind === "unreadable") {
      // "Cannot tell" is never quieter than "wrong": besides the warning (which says why, by code), the unreadable settings count as a finding,
      // so the on-call Admins are alerted and the Hub shows it until a later check reads both settings as right.
      log.error("messaging_service.settings_check_failed", { reason: reading.reason });
      await ops.record(db, { kind: "messaging.service_settings_wrong", detail: { geo_not_canada_only: false, pumping_protection_off: false, unreadable: true } });
      await ops.record(db, { kind: "messaging.service_check_failed", detail: { reason: reading.reason, check: "abuse_settings" } }).catch((error: unknown) => {
        log.error("messaging_service.settings_check_failed_not_recorded", { error: error instanceof Error ? error.name : "NonError" });
      });
      return { settings: "unreadable", reason: reading.reason };
    }
    if (!reading.geoCanadaOnly || !reading.pumpingProtection) {
      const geoNotCanadaOnly = !reading.geoCanadaOnly;
      const pumpingProtectionOff = !reading.pumpingProtection;
      await ops.record(db, { kind: "messaging.service_settings_wrong", detail: { geo_not_canada_only: geoNotCanadaOnly, pumping_protection_off: pumpingProtectionOff } });
      log.error("messaging_service.settings_wrong", { geo_not_canada_only: geoNotCanadaOnly, pumping_protection_off: pumpingProtectionOff });
      return { settings: "wrong", geoNotCanadaOnly, pumpingProtectionOff };
    }
    await ops.record(db, { kind: "messaging.service_settings_ok", detail: {} }).catch((error: unknown) => {
      log.error("messaging_service.settings_ok_not_recorded", { error: error instanceof Error ? error.name : "NonError" });
    });
    log.info("messaging_service.settings_checked", { geo_canada_only: true, pumping_protection: true });
    return { settings: "right" };
  }

  return {
    async run() {
      // One fetch of the service gives both readings. Smart Encoding is judged first (S06.02), then the abuse protections (S07.09); each records its
      // own finding, and a failure to record the first does not stop the second from being judged.
      const { encoding: encodingReading, settings: settingsReading } = await reader.readBoth(messagingServiceSid);
      const encoding = await checkSmartEncoding(encodingReading).then((value) => ({ status: "fulfilled" as const, value }), (reason: unknown) => ({ status: "rejected" as const, reason }));
      const settings = await checkSettings(settingsReading).then((value) => ({ status: "fulfilled" as const, value }), (reason: unknown) => ({ status: "rejected" as const, reason }));
      if (settings.status === "rejected") throw settings.reason;
      if (encoding.status === "rejected") throw encoding.reason;
      return { encoding: encoding.value, settings: settings.value };
    },
  };
}
