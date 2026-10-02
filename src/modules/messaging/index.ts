// The messaging module's public interface (AD-2, AD-8). Today it holds only S01.15's first-text
// spike: one test text from production to an approved phone, through the Twilio adapter. E06's
// outbound queue replaces it (and nothing else may call the SMS adapter then).
import type { Db } from "../../platform/db";
import * as audit from "../audit";
import { drizzleTestSendStore } from "./adapters/testSendStore";
import { twilioSmsProvider } from "./adapters/twilioSms";
import {
  createTestTextService,
  listUnknownAttempts as listUnknown,
  numberKeyFromSecret,
  type TestTextAudit,
  type TestTextConfig,
  type TestTextLog,
  type TestTextService,
  type UnknownAttempt,
} from "./application/sendTestText";
import type { SmsProvider } from "./application/ports";

export interface TestTextWiring {
  db: Db;
  config: TestTextConfig;
  /** Twilio's account; absent where there are no credentials (then nothing can be sent). */
  twilio?: { accountSid: string; authToken: string };
  /** Test seams: another provider (a fake), the audit writer and the operational log. */
  provider?: SmsProvider;
  audit?: TestTextAudit;
  log?: TestTextLog;
}

/** Structured, one JSON line per event, and never a number: the events carry ids and codes only. */
const consoleLog: TestTextLog = {
  error: (evt, fields) => console.log(JSON.stringify({ level: "error", evt, module: "messaging", ...fields })),
};

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
    // The number's hash is keyed by the Twilio auth token. There is no fallback key: without credentials nothing can
    // be sent, so the key is never asked for, and asking for it anyway is a bug that must fail loudly.
    // TODO(E06): introduce a dedicated SMS_NUMBER_HASH_KEY instead of deriving the key from the Twilio auth token
    // (rotating the token must not change the hashes the 5-minute rule compares).
    numberKey: () => {
      if (!twilio) throw new Error("The test text's number key needs Twilio's credentials");
      return numberKeyFromSecret(twilio.authToken);
    },
    log: wiring.log ?? consoleLog,
  });
}

/** The attempts claimed more than a minute ago whose answer was never recorded ("outcome unknown"); no numbers. */
export function listUnknownAttempts(db: Db): Promise<UnknownAttempt[]> {
  return listUnknown(db, drizzleTestSendStore);
}

export { maskNumber, maskedLabels, TEST_TEXT_BODY, DUPLICATE_WINDOW_MS, isE164, isRequestId } from "./domain/testText";
export type { TestTextRefusal } from "./domain/testText";
export { numberChoice, numberKeyFromSecret, resolveNumberChoice, UNKNOWN_AFTER_MS } from "./application/sendTestText";
export type { SendTestTextInput, SendTestTextOutcome, TestTextConfig, TestTextLog, TestTextService, UnknownAttempt } from "./application/sendTestText";
export type { ProviderAnswer, SmsProvider } from "./application/ports";
