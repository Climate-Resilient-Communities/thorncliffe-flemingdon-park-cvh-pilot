// The Messaging Service's configuration check (S06.02, AD-21): the frozen body is sent byte for byte, so Smart Encoding (which
// replaces characters it thinks are the same) must be off on the Twilio Messaging Service. Every request already sets
// `SmartEncoded=false`; this is defence in depth, run daily by the health job and on every change to the service that the
// procedures record. It reads the one setting and, when it is on, records `messaging.smart_encoding_on` in ops_event (the
// health job turns it into the on-call alert, S06.07). It changes nothing in Twilio, and it never reads a number or a body.
//
// Configuration control (the procedures state it, S09.03): only named Admins change the Messaging Service, and texts are paused
// while they do, so a setting changed by hand is never live while texts are going out.
import type { Db } from "../../../platform/db";
import type { MessagingLog } from "./deliveryPorts";
import type { MessagingServiceReader, OpsRecorder } from "./dispatcherPorts";

export type ServiceCheckResult =
  /** Smart Encoding is off, as it must be. */
  | { status: "smart_encoding_off" }
  /** Smart Encoding is on: recorded as an ops_event with severity error. */
  | { status: "smart_encoding_on" }
  /** The setting could not be read (a code, never a message): recorded as a warning, so a silent failure is not mistaken for "off". */
  | { status: "unreadable"; reason: string };

export interface MessagingServiceCheckDeps {
  db: Db;
  reader: MessagingServiceReader;
  messagingServiceSid: string;
  ops: OpsRecorder;
  log: MessagingLog;
}

export interface MessagingServiceCheck {
  run(): Promise<ServiceCheckResult>;
}

export function createMessagingServiceCheck(deps: MessagingServiceCheckDeps): MessagingServiceCheck {
  const { db, reader, messagingServiceSid, ops, log } = deps;
  return {
    async run() {
      const reading = await reader.readSmartEncoding(messagingServiceSid);
      if (reading.kind === "unreadable") {
        await ops.record(db, { kind: "messaging.service_check_failed", detail: { reason: reading.reason } });
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
    },
  };
}
