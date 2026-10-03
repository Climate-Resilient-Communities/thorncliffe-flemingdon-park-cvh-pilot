import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import { describe, expect, it, vi } from "vitest";
import type { MessagingOpsEvent } from "@/modules/messaging";
import type { Db } from "@/platform/db";
import { appStatusCallbacks } from "./statusCallback";

const getDb = vi.hoisted(() => vi.fn(() => {
  throw new Error("the database was asked for");
}));
vi.mock("@/platform/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/platform/db")>()), getDb }));
vi.mock("@/platform/config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/platform/config/env")>()),
  getEnv: () => ({ publicBaseUrl: "https://cvh.example", smsPricePerSegmentCents: 1.5 }),
}));

const TOKEN = "fake-auth-token-for-tests";
const ACCOUNT = `AC${"0".repeat(32)}`;
const fields = { MessageSid: `SM${"1".repeat(32)}`, MessageStatus: "delivered", To: "+14165550123" };
const body = new URLSearchParams(fields).toString();

describe("the status callbacks of the app", () => {
  it("refuse to believe anything where there is no Twilio account, and never touch the database (the environment may have none)", async () => {
    const callbacks = appStatusCallbacks();
    await expect(callbacks.handle({ signature: getExpectedTwilioSignature(TOKEN, "https://cvh.example/api/twilio/status", fields), search: "", body })).resolves.toEqual({ kind: "not_configured" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("check the signature with the account's Auth Token against the environment's PUBLIC_BASE_URL, and record what they refuse in ops_event", async () => {
    const events: MessagingOpsEvent[] = [];
    const callbacks = appStatusCallbacks({
      env: { twilio: { accountSid: ACCOUNT, authToken: TOKEN }, publicBaseUrl: "https://cvh.example", smsPricePerSegmentCents: 1.5 },
      db: {} as Db,
      ops: { record: async (_executor, event) => void events.push(event) },
      log: { info: () => undefined, error: () => undefined },
    });
    // Signed with the account's token for the environment's own URL, with no ref: believed, and about nothing.
    const ok = { signature: getExpectedTwilioSignature(TOKEN, "https://cvh.example/api/twilio/status", fields), search: "", body };
    await expect(callbacks.handle(ok)).resolves.toEqual({ kind: "ignored", reason: "no_ref" });
    // The same signature for another origin, or from another token, is refused.
    await expect(callbacks.handle({ ...ok, signature: getExpectedTwilioSignature(TOKEN, "https://other.example/api/twilio/status", fields) })).resolves.toMatchObject({ kind: "rejected" });
    await expect(callbacks.handle({ ...ok, signature: getExpectedTwilioSignature("another-token", "https://cvh.example/api/twilio/status", fields) })).resolves.toMatchObject({ kind: "rejected" });
    expect(events.map((event) => event.kind)).toEqual(["delivery.callback_ignored", "webhook.signature_invalid", "webhook.signature_invalid"]);
  });
});
