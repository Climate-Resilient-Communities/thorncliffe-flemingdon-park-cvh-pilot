// The messaging module's public interface (AD-2, AD-8). Today it holds only S01.15's first-text
// spike: one test text from production to an approved phone, through the Twilio adapter. E06's
// outbound queue replaces it (and nothing else may call the SMS adapter then).
import type { Db } from "../../platform/db";
import * as audit from "../audit";
import { drizzleTestSendStore } from "./adapters/testSendStore";
import { twilioSmsProvider } from "./adapters/twilioSms";
import { createTestTextService, numberKeyFromSecret, type TestTextAudit, type TestTextConfig, type TestTextService } from "./application/sendTestText";
import type { SmsProvider } from "./application/ports";

export interface TestTextWiring {
  db: Db;
  config: TestTextConfig;
  /** Twilio's account; absent where there are no credentials (then nothing can be sent). */
  twilio?: { accountSid: string; authToken: string };
  /** Test seams: another provider (a fake), the audit writer and the clock. */
  provider?: SmsProvider;
  audit?: TestTextAudit;
  now?: () => Date;
}

/** The first-text spike's use case, on the app's database and Twilio's REST API. */
export function createTestText(wiring: TestTextWiring): TestTextService {
  const { db, config, twilio } = wiring;
  const provider = wiring.provider ?? (twilio ? twilioSmsProvider(twilio) : undefined);
  return createTestTextService({
    db,
    store: drizzleTestSendStore,
    provider,
    audit: wiring.audit ?? { record: audit.record, recordRefusal: audit.recordRefusal },
    config,
    // Keyed by the Twilio auth token when there is one; otherwise nothing can be sent, so the key is never used.
    numberKey: numberKeyFromSecret(twilio?.authToken ?? "no-twilio-credentials"),
    now: wiring.now,
  });
}

export { maskNumber, TEST_TEXT_BODY, DUPLICATE_WINDOW_MS, isE164, isRequestId } from "./domain/testText";
export type { TestTextRefusal } from "./domain/testText";
export type { SendTestTextInput, SendTestTextOutcome, TestTextConfig, TestTextService } from "./application/sendTestText";
export type { ProviderAnswer, SmsProvider } from "./application/ports";
