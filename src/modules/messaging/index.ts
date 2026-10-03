// The messaging module's public interface (AD-2, AD-8, AD-21). It holds S04.06's renderer (the one builder of an
// alert's text message body, its encoding and segment count, and the cost estimate), the outbox (S06.01: every
// outbound text is one `delivery` row, written before it is sent and never holding a phone number; the states, the
// idempotent queue, the ContactResolver port) and S01.15's first-text spike: one test text from production to an
// approved phone, through the Twilio adapter. E06's sender replaces the spike (and nothing else may call the SMS
// adapter then: a dependency rule enforces that no other module imports an SMS adapter).
import type { Db } from "../../platform/db";
import * as audit from "../audit";
import { drizzleDeliveryStore } from "./adapters/deliveryStore";
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
import { createDeliveryQueueService, type DeliveryQueue, type DeliveryQueueDeps } from "./application/deliveryQueue";

export interface DeliveryQueueWiring {
  /** Test seams. */
  newId?: DeliveryQueueDeps["newId"];
  now?: DeliveryQueueDeps["now"];
}

/**
 * The outbox's use cases on the `delivery` table. They run in the caller's transaction (the approval's, the sign-up's), so the
 * module needs no database handle of its own.
 */
export function createDeliveryQueue(wiring: DeliveryQueueWiring = {}): DeliveryQueue {
  return createDeliveryQueueService({ store: drizzleDeliveryStore, newId: wiring.newId, now: wiring.now });
}

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
export {
  NINE_ONE_ONE_FIRST_TYPES,
  alertLink,
  isNineOneOneFirst,
  render,
  renderAll,
  type RenderedSms,
  type SmsAttribution,
  type SmsEntry,
  type SmsTranslated,
} from "./domain/smsBody";
export { NORMALISATION_TABLE, SMS_MAX_BODY_LENGTH, countSms, normaliseSms, type SmsCount, type SmsEncoding } from "./domain/smsEncoding";
export { estimateSmsCost, priceInThousandthsOfCent, type CostBasis, type SmsCostEstimate, type SmsCostInput } from "./domain/smsCost";

// The outbox (S06.01).
export { ContactNumberInvalid, ContactSourceNotWired, createContactResolver } from "./application/contactResolver";
export type {
  AlertTextInput,
  CampaignTextInput,
  DeliveryQueue,
  TransactionalInput,
} from "./application/deliveryQueue";
export type {
  ContactResolver,
  DeliveryRecipient,
  DeliveryResult,
  DeliveryStore,
  DeliveryView,
  Enqueued,
  MessagingLog,
  NewDelivery,
  RecipientNumberSource,
  RecipientNumberSources,
  ResolvedContact,
  SendBy,
  SkippedForRecipient,
} from "./application/deliveryPorts";
export { stdoutMessagingLog } from "./adapters/messagingLog";
export {
  ALERT_RECIPIENT_KINDS,
  BODY_MAX_CHARS,
  CAMPAIGN_RECIPIENT_KINDS,
  CHANNELS,
  CREATING_MODULES,
  DELIVERY_KINDS,
  NUMBER_CONSUMED_AT_HAND_OFF,
  RECIPIENT_KINDS,
  RECIPIENT_OWNER,
  SEGMENTS_MAX,
  TRANSACTIONAL_PURPOSES,
  alertKey,
  campaignRefusal,
  contentRefusal,
  isConsumedAtHandOff,
  outboundKey,
  purposeRule,
  transactionalRefusal,
  type Channel,
  type CreatingModule,
  type DeliveryContent,
  type DeliveryKind,
  type DeliveryRefusal,
  type RecipientKind,
  type TransactionalPurpose,
} from "./domain/deliveryRules";
export {
  DELIVERY_STATES,
  TERMINAL_STATES,
  TRANSITION_TABLE,
  UNRESOLVED_STATES,
  canStopBeforeHandOff,
  canTransition,
  isTerminal,
  type DeliveryState,
  type TransitionRow,
} from "./domain/deliveryState";
export { looksLikePhoneNumber, maskForLog, maskPhoneNumbers } from "./domain/phoneNumber";
