// The messaging module's public interface (AD-2, AD-8, AD-21). It holds S04.06's renderer (the one builder of an alert's text
// message body, its encoding and segment count, and the cost estimate), the outbox (S06.01: every outbound text is one `delivery`
// row, written before it is sent and never holding a phone number; the states, the idempotent queue, the ContactResolver
// port), the sender (S06.02: the dispatcher: the sender lease, the claim order, the hand-off point, the pace, the outcomes) with
// the Messaging Service check, and S01.15's first-text spike: one test text from production to an approved phone, through the
// Twilio adapter. S06.06 adds the pause: the one switch an Admin sets to stop every text not yet handed to the provider.
// E06's sender replaces the spike (and nothing else may call the SMS adapter then: a dependency rule enforces that no other
// module imports an SMS adapter).
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
  type TestTextDeps,
  type TestTextLog,
  type TestTextService,
  type UnknownAttempt,
} from "./application/sendTestText";
import type { SmsProvider } from "./application/ports";
import { createDeliveryQueueService, type DeliveryQueue, type DeliveryQueueDeps } from "./application/deliveryQueue";
import { drizzleDispatchStore } from "./adapters/dispatchStore";
import { createDispatcher as createDispatcherService } from "./application/dispatcher";
import type { DispatchStore, Dispatcher, DispatcherDeps } from "./application/dispatcherPorts";
import { drizzleCallbackStore } from "./adapters/callbackStore";
import { createStatusCallbacks as createStatusCallbacksService, type CallbackStore, type StatusCallbackDeps, type StatusCallbacks } from "./application/statusCallback";
import { createMessagingServiceCheck, type MessagingServiceCheck, type MessagingServiceCheckDeps } from "./application/serviceCheck";
import { drizzlePauseStore } from "./adapters/pauseStore";
import { createMessagingPause as createMessagingPauseService, type MessagingPause, type PauseAudit, type PauseStore } from "./application/messagingPause";

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

export type DispatcherWiring = Omit<DispatcherDeps, "store"> & {
  /** Test seam: another store (for example one that stalls a run at a chosen point); the app's own table by default. */
  store?: DispatchStore;
};

/**
 * The sender (S06.02): the dispatcher on the outbox's table, the sender lease and the pause switch. The caller (the composition
 * root, src/app/dispatch.ts) gives it the ContactResolver, the alert reader, the clock and, in production only, the provider.
 * Nothing else sends a text: this is the one use case that hands a delivery to the SMS provider.
 */
export function createDispatcher(wiring: DispatcherWiring): Dispatcher {
  return createDispatcherService({ ...wiring, store: wiring.store ?? drizzleDispatchStore });
}

export type StatusCallbackWiring = Omit<StatusCallbackDeps, "store"> & {
  /** Test seam: another store; the app's own table by default. */
  store?: CallbackStore;
};

/**
 * The provider's status callbacks (S06.04): the signature check and the application of a signed status to the delivery it names, by the
 * transition table. The one way a delivery reaches `delivered` or `undelivered`. The caller (src/app/statusCallback.ts) gives it the
 * Twilio account's Auth Token, PUBLIC_BASE_URL and ops' event log.
 */
export function createStatusCallbacks(wiring: StatusCallbackWiring): StatusCallbacks {
  return createStatusCallbacksService({ ...wiring, store: wiring.store ?? drizzleCallbackStore });
}

export type MessagingServiceCheckWiring = MessagingServiceCheckDeps;

/** The daily check of the Messaging Service's Smart Encoding setting (S06.02). */
export function createServiceCheck(wiring: MessagingServiceCheckWiring): MessagingServiceCheck {
  return createMessagingServiceCheck(wiring);
}

export interface MessagingPauseWiring {
  db: Db;
  /** Test seams: another store, and the audit writer. */
  store?: PauseStore;
  audit?: PauseAudit;
}

/**
 * The pause (S06.06): an Admin's one switch that stops every text not yet handed to the provider, and what it says now. The use
 * cases run in their own transactions (the pause or resume and its audit record, together). Who may call them is the staff guard's rule
 * (`sending.pause`, Admins at aal2), asked by the caller before it comes here.
 */
export function createMessagingPause(wiring: MessagingPauseWiring): MessagingPause {
  return createMessagingPauseService({
    db: wiring.db,
    store: wiring.store ?? drizzlePauseStore,
    audit: wiring.audit ?? { record: audit.record, recordRefusal: audit.recordRefusal },
  });
}

export interface TestTextWiring {
  db: Db;
  config: TestTextConfig;
  /** Twilio's account; absent where there are no credentials (then nothing can be sent). */
  twilio?: { accountSid: string; authToken: string };
  /** Test seams: another provider (a fake), the audit writer, the operational log and the reading of the pause switch. */
  provider?: SmsProvider;
  audit?: TestTextAudit;
  log?: TestTextLog;
  isPaused?: TestTextDeps["isPaused"];
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
    // The pause (S06.06) stops this text too. A missing switch counts as paused, as it does for the sender.
    isPaused:
      wiring.isPaused ??
      (async () => {
        const row = await drizzlePauseStore.read(db);
        return row === null || row.paused;
      }),
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

// The sender (S06.02).
export { twilioMessageSubmitter, twilioMessagingServiceReader, notSentReason } from "./adapters/twilioMessagingService";
export type { TwilioServiceConfig } from "./adapters/twilioMessagingService";
export { drizzleDispatchStore } from "./adapters/dispatchStore";
export { drizzlePauseStore } from "./adapters/pauseStore";
export { CampaignReaderNotWired, MESSAGING_OPS_EVENT_KINDS } from "./application/dispatcherPorts";
export type {
  AlertStandingReader,
  CampaignStandingReader,
  ClaimResult,
  DispatchReport,
  DispatchStore,
  Dispatcher,
  DispatcherClock,
  DispatcherConfig,
  DispatcherDeps,
  Lease,
  LockedDelivery,
  MessageSubmission,
  MessageSubmitter,
  MessagingOpsEvent,
  MessagingOpsEventKind,
  MessagingServiceReader,
  OpsRecorder,
  SmartEncodingReading,
  StoppedState,
  SweepResult,
} from "./application/dispatcherPorts";
export type { MessagingServiceCheck, ServiceCheckResult } from "./application/serviceCheck";

// The status callbacks (S06.04).
export { drizzleCallbackStore } from "./adapters/callbackStore";
export type { CallbackRequest, CallbackResult, CallbackStore, StatusCallbackDeps, StatusCallbacks } from "./application/statusCallback";
export {
  CALLBACK_IGNORED_REASONS,
  CALLBACK_IGNORE_REASONS,
  CALLBACK_TARGETS,
  NON_TERMINAL_CALLBACK_STATUSES,
  SIGNATURE_FAILURE_REASONS,
  STATUS_CALLBACK_PATH,
  TERMINAL_CALLBACK_STATUSES,
  callbackTarget,
  decideCallback,
  parseCallbackPayload,
  readCallbackRef,
  type CallbackDecision,
  type CallbackIgnoreReason,
  type CallbackIgnoredReason,
  type CallbackPayload,
  type CallbackRefReading,
  type CallbackRow,
  type CallbackTarget,
  type SignatureFailureReason,
} from "./domain/statusCallback";
export { expectedTwilioSignature, isValidTwilioSignature, type FormParameters } from "./domain/twilioSignature";
export {
  AUTH_FAILURE_LIMIT,
  BACKOFF_MS,
  CLAIM_BATCH_ROWS,
  CLAIM_EXPIRY_MS,
  CLAIM_RANKS,
  DEFAULT_SEGMENTS_PER_SECOND,
  FIRST_ALERT_TYPES,
  KICK_RUN_LIMIT_MS,
  LEASE_RENEW_AFTER_MS,
  LEASE_TTL_MS,
  MAX_ATTEMPTS,
  NOT_SENDABLE_REASONS,
  NOT_SENT_REASONS,
  NO_ANSWER_REASONS,
  OUTCOME_WRITE_ALLOWANCE_MS,
  PROVIDER_TIMEOUT_MS,
  RUN_LIMIT_MS,
  RUN_MARGIN_MS,
  STATUS_CALLBACK_CONNECTION_OVERRIDES,
  SUBMITTED_EXPIRY_MS,
  SWEEP_BATCH_ROWS,
  UNKNOWN_CAUSES,
  alertNotSendable,
  authFailureStopsRun,
  capacitySegments,
  claimRank,
  classifyAnswer,
  createPaceLimiter,
  isAuthFailure,
  pauseApplies,
  providerStatusCallbackUrl,
  statusCallbackUrl,
  takeWithinSegments,
  type AlertStanding,
  type ClaimRank,
  type NoAnswerReason,
  type NotSendable,
  type NotSendableReason,
  type NotSentReason,
  type PaceLimiter,
  type SubmitAnswer,
  type SubmitOutcome,
  type UnknownCause,
} from "./domain/dispatchRules";

// The pause (S06.06).
export { MessagingControlInconsistent, MessagingControlMissing } from "./application/messagingPause";
export type { MessagingPause, PauseAudit, PauseOutcome, PauseRow, PauseStatus, PauseStore, PausedStatus, ResumeOutcome } from "./application/messagingPause";
export { PAUSE_REASON_MAX_CHARS, cleanPauseReason, type CleanedReason, type PauseReasonProblem } from "./domain/pauseRules";

// The renderer (S04.06).
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
