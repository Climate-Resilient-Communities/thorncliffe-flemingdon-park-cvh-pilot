// The messaging module's public interface (AD-2, AD-8, AD-21). It holds S04.06's renderer (the one builder of an alert's text
// message body, its encoding and segment count, and the cost estimate), the outbox (S06.01: every outbound text is one `delivery`
// row, written before it is sent and never holding a phone number; the states, the idempotent queue, the ContactResolver
// port), the sender (S06.02: the dispatcher: the sender lease, the claim order, the hand-off point, the pace, the outcomes) with
// the Messaging Service check, the pause (S06.06: the one switch an Admin sets to stop every text not yet handed to the provider)
// and the sending progress of an entry (S06.09). The sender replaced S01.15's first-text spike (S06.09 removed it): the Twilio
// adapters are called only by the dispatcher (src/app/dispatch.ts) and the reconciliation job (src/app/reconcile.ts), and a
// dependency rule and a test fail if any other file imports them.
import type { Db } from "../../platform/db";
import * as audit from "../audit";
import { drizzleDeliveryStore } from "./adapters/deliveryStore";
import { createDeliveryQueueService, type DeliveryQueue, type DeliveryQueueDeps } from "./application/deliveryQueue";
import { drizzleDispatchStore } from "./adapters/dispatchStore";
import { createDispatcher as createDispatcherService } from "./application/dispatcher";
import type { DispatchStore, Dispatcher, DispatcherDeps } from "./application/dispatcherPorts";
import { drizzleCallbackStore } from "./adapters/callbackStore";
import { createStatusCallbacks as createStatusCallbacksService, type CallbackStore, type StatusCallbackDeps, type StatusCallbacks } from "./application/statusCallback";
import { createMessagingServiceCheck, type MessagingServiceCheck, type MessagingServiceCheckDeps } from "./application/serviceCheck";
import { drizzlePauseStore } from "./adapters/pauseStore";
import { createMessagingPause as createMessagingPauseService, type MessagingPause, type PauseAudit, type PauseStore } from "./application/messagingPause";
import { stdoutMessagingLog } from "./adapters/messagingLog";
import { drizzleProviderIds } from "./adapters/providerIdStore";
import { createSmsSpendHooks, type SmsSpendDeps, type SmsSpendHooks } from "./application/smsSpend";
import { drizzleMeasureStore } from "./adapters/measureStore";
import { createDeliveryMeasures as createDeliveryMeasuresService, type DeliveryMeasures } from "./application/deliveryMeasures";
import type { DeliveryProviderIds } from "../spend";
import { drizzleSenderHealth } from "./adapters/healthStore";
import type { SenderHealthReader } from "./application/senderHealth";

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

export type SmsSpendWiring = Omit<SmsSpendDeps, "store" | "log"> & { log?: SmsSpendDeps["log"] };

/**
 * The spend seams of the sender and the status callbacks (S06.08): `afterOutcome` writes a text's estimate to `spend_event` in the
 * transaction that records its outcome, `afterProviderId` runs the matching rule when a provider id is recorded later. The composition
 * root passes the same hooks to `createDispatcher` and `createStatusCallbacks`. Throws for a price per segment that is not valid.
 */
export function createSmsSpend(wiring: SmsSpendWiring): SmsSpendHooks {
  return createSmsSpendHooks({ log: stdoutMessagingLog, ...wiring, store: drizzleProviderIds });
}

/**
 * The provider ids of deliveries, as the spend module's reconciliation asks for them (its `DeliveryProviderIds` port: spend may not import
 * messaging, so the composition root wires this in).
 */
export const deliveryProviderIds: DeliveryProviderIds = drizzleProviderIds;

/** The pilot's delivery measures (S06.08): time to deliver per entry and language, and a correction's reach, drills apart. */
export function createDeliveryMeasures(): DeliveryMeasures {
  return createDeliveryMeasuresService({ store: drizzleMeasureStore });
}

/**
 * What the health job (ops, S06.07) reads about the sender: how many texts are stuck or due, how long ago the sender lease was renewed, the
 * texts handed off with no outcome, and the deliveries that are `unknown`. Counts, ages and ids only.
 */
export function createSenderHealth(): SenderHealthReader {
  return drizzleSenderHealth;
}

/** The estimated cost of the texts waiting to be sent, in whole cents CAD (S07.08: the spend cap counts them before the provider has accepted them). */
export { queuedCostCents } from "./adapters/queuedCost";
export {
  LEASE_STALE_AFTER_MS,
  STUCK_QUEUE_AFTER_MS,
  UNKNOWN_IDS_LIMIT,
  UNKNOWN_WINDOW_MS,
  UNSETTLED_HAND_OFF_AFTER_MS,
  type SenderHealth,
  type SenderHealthReader,
} from "./application/senderHealth";

// A drill's results (S06.05, FR-M4): per roster member and language, kept apart from every count of a real alert.
export { drillResults, type DrillResultRow, type DrillResults } from "./application/drillResults";

// The sending progress of an entry (S06.09, O-06): per language what became of its texts, and why the ones that did not arrive did not. Counts, languages and
// codes only; a drill's texts are never counted (their own view is `drillResults`).
import { drizzleProgressStore } from "./adapters/progressStore";
import { createSendingProgress, PROBLEM_LIST_LIMIT, type SendingProgress } from "./application/sendingProgress";

export const sendingProgress: SendingProgress = createSendingProgress({ store: drizzleProgressStore });
export { PROBLEM_LIST_LIMIT };
export type { ProblemRow, ProgressStore, SendingProgress } from "./application/sendingProgress";
export {
  PROBLEM_MEANINGS,
  PROBLEM_STATES,
  PROGRESS_COUNT_KEYS,
  bucketOf,
  emptyCounts,
  isProblemState,
  problemMeaning,
  progressOf,
  referenceOf,
  sumOf,
  totalOf,
  type EntryProgress,
  type LanguageProgress,
  type ProblemMeaning,
  type ProblemState,
  type ProblemText,
  type ProgressCounts,
} from "./domain/sendingProgress";

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
export { looksLikePhoneNumber, maskForLog, maskNumber, maskPhoneNumbers } from "./domain/phoneNumber";

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
  AbuseSettingsReading,
  StoppedState,
  SweepResult,
} from "./application/dispatcherPorts";
export type { MessagingServiceCheck, ServiceCheckFinding, ServiceCheckResult, SettingsCheckResult } from "./application/serviceCheck";

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
export { ONCALL_TEXT_CONDITIONS, renderOncallText, type OncallTextCondition, type RenderedOncallText } from "./domain/oncallText";
export { NORMALISATION_TABLE, SMS_MAX_BODY_LENGTH, countSms, normaliseSms, type SmsCount, type SmsEncoding } from "./domain/smsEncoding";
export { estimateSmsCost, priceInThousandthsOfCent, type CostBasis, type SmsCostEstimate, type SmsCostInput } from "./domain/smsCost";

// The cost of each text, and the reconciliation's listing of the provider's prices (S06.08).
export { createSmsSpendHooks, smsEstimateCents } from "./application/smsSpend";
export type { ProviderIdReader, SmsSpendDeps, SmsSpendHooks } from "./application/smsSpend";
export { MessageListError, twilioMessageLister } from "./adapters/twilioMessageList";
export type { TwilioListConfig } from "./adapters/twilioMessageList";
export type { DeliveryMeasures, MeasureStore } from "./application/deliveryMeasures";
export {
  DELIVERED_SHARE_PERCENT,
  NEVER_SENT_STATES,
  correctionReach,
  entryTimings,
  splitDrills,
  wasHandedOff,
  type CorrectionReach,
  type DeliveredShareReading,
  type EntryTimings,
  type LanguageTiming,
  type MeasuredRow,
  type ReachRow,
} from "./domain/deliveryMeasures";

// How far corrections, withdrawals and finals reached, for the Hub (S07.10, FR-M4): the SQL view `correction_reach`, drills apart.
export { CORRECTION_REACH_KINDS, readCorrectionReach, type CorrectionReachKind, type CorrectionReachReport, type CorrectionReachRow } from "./application/reachReport";

// The subscribers an alert's entries were queued to text (S07.07): what subscriptions' recipient port adds to a correction's, a withdrawal's and a final's own audience.
export { subscribersQueuedFor } from "./adapters/entryRecipientStore";

// The texts held for a resident's records (S09.03): what a resident's access request reads back, without the body, the provider's id or the key.
export { textsToRecipients, type RecipientText } from "./adapters/recipientTextStore";

// A resend (S09.02, AR-21): an Admin's deliberate action that creates a new delivery copying an earlier one of the chain, never by itself. The caller (the staff
// surface, src/app/staff/resendSeam.ts) gives it the resident's standing (subscriptions), the entry's standing (alerting) and the spend cap's check (spend).
import { drizzleResendStore } from "./adapters/resendStore";
import { createResend as createResendService, type Resend, type ResendAudit, type ResendDeps } from "./application/resend";

export interface ResendWiring {
  db: Db;
  recipients: ResendDeps["recipients"];
  standing: ResendDeps["standing"];
  spendCap?: ResendDeps["spendCap"];
  /** Test seams: another audit writer, the ids and the clock. */
  audit?: ResendAudit;
  newId?: ResendDeps["newId"];
  now?: ResendDeps["now"];
}

/** The resend (S09.02): each call is one transaction, with its audit record. Who may resend is the guard's rule (`delivery.resend`, Admins, at aal2), asked before. */
export function createResend(wiring: ResendWiring): Resend {
  return createResendService({
    db: wiring.db,
    store: drizzleResendStore,
    audit: wiring.audit ?? { record: audit.record, recordRefusal: audit.recordRefusal },
    recipients: wiring.recipients,
    standing: wiring.standing,
    spendCap: wiring.spendCap,
    newId: wiring.newId,
    now: wiring.now,
  });
}
export type { NotResent, Resend, ResendAudit, ResendDeps, ResendInput, ResendOutcome, ResendRecipients, ResendSpendCap, ResendStanding, ResendStore, RootText } from "./application/resend";
export {
  BULK_RESEND_LIMIT,
  BULK_RESEND_STATES,
  RESENDABLE_STATES,
  RESEND_LIMIT,
  RESEND_REFUSALS,
  UNRECEIVABLE_MEANINGS,
  decideResend,
  latestOf,
  resendKey,
  unreceivableMeaning,
  type ChainText,
  type ResendDecision,
  type ResendFacts,
  type ResendRefusal,
} from "./domain/resend";
