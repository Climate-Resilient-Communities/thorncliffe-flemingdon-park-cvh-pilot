// The alerting module's public interface (AD-2, AD-5): alert threads and their entries, and the one
// lifecycle they follow. Other modules and the app use only what is exported here.
import type { Db } from "../../platform/db";
import { readStaffStanding } from "../identity";
import { createResidentBuildings, floorsOfBuilding, neighbourhoodIds, neighbourhoodsOfBuildings } from "../places";
import * as audit from "../audit";
import { createDeliveryQueue, type DeliveryResult } from "../messaging";
import { recordOpsEvent, type OpsEvent } from "../ops";
import { createFeedReader, requireDb, type FeedAlerts, type FeedPlaces, type FeedReader } from "./application/feed";
import { createAlertLifecycle, type AlertLifecycle, type AlertLifecycleDeps } from "./application/lifecycle";
import { createEntryPreparer, type EntryTranslator } from "./application/prepareEntry";
import { createSubmitter, type AlertSubmitter } from "./application/submit";
import type { FreezeResult } from "./application/ports";
import type { FreezeInput } from "./application/freezeContent";

/** What the sender's hand-off point reads about an alert delivery's entry and thread (messaging's AlertStandingReader port, S06.02). */
export { alertStandingReader, isClosingEntry } from "./adapters/handOffStanding";

export interface AlertingWiring {
  db: Db;
  /** Test seams. */
  now?: AlertLifecycleDeps["now"];
  newId?: AlertLifecycleDeps["newId"];
  newSlug?: AlertLifecycleDeps["newSlug"];
  latestValidUntil?: AlertLifecycleDeps["latestValidUntil"];
  audit?: AlertLifecycleDeps["audit"];
  staff?: AlertLifecycleDeps["staff"];
  places?: AlertLifecycleDeps["places"];
  /** Who the text reaches: subscriptions' count and `captureRecipients` (S04.07). Default: subscriptions' port, empty until E07. */
  recipients?: AlertLifecycleDeps["recipients"];
  /** The outbox's approval marker and alert-text writer (S06.01); see `createAlerting`. Default: messaging's `createDeliveryQueue()`. */
  markApproval?: AlertLifecycleDeps["markApproval"];
  queueAlertTexts?: AlertLifecycleDeps["queueAlertTexts"];
  /** Cents CAD per text message segment, for each queued text's cost estimate (src/app/staff/alerts.ts gives `getEnv().smsPricePerSegmentCents`). */
  pricePerSegmentCents?: AlertLifecycleDeps["pricePerSegmentCents"];
}

export interface AlertSubmitterWiring {
  /** The lifecycle (createAlerting) the submitter's short transactions are. */
  alerting: AlertLifecycle;
  db: Db;
  /** Translates the English into every language (translation's `createSubmitTranslator`, or `noTranslation` where no model is configured). */
  translator: EntryTranslator;
  /** Whether a translation model is configured: with none, every language falling back is expected and not an ops event. */
  translationConfigured: boolean;
  /** `freezeContent` with the public origin filled in (src/app/staff/freezeEntry.ts). */
  freeze: (input: Omit<FreezeInput, "publicBaseUrl">) => FreezeResult;
  /** Test seams. */
  now?: AlertLifecycleDeps["now"];
  ops?: { record(event: OpsEvent): Promise<void> };
  settleMs?: number;
}

/** Submit, end to end (S04.05): one press of Submit or of "Try translation again", from the browser's key to a frozen, pending entry. */
export function createAlertSubmitter(wiring: AlertSubmitterWiring): AlertSubmitter {
  return createSubmitter({
    lifecycle: wiring.alerting,
    preparer: createEntryPreparer({ translator: wiring.translator, freeze: wiring.freeze }),
    ops: wiring.ops ?? { record: (event) => recordOpsEvent(wiring.db, event) },
    translationConfigured: wiring.translationConfigured,
    now: wiring.now,
    settleMs: wiring.settleMs,
  });
}

/**
 * What the outbox answers is a value; a refusal of something a correct approval never asks (an id that is not a UUID, a body the entry did not
 * freeze) is a bug, so the approval fails with it and its transaction rolls back, deliveries and all.
 */
function settled<T>(result: DeliveryResult<T>, what: string): T {
  if (!result.ok) throw new Error(`alerting: the outbox refused ${what}: ${result.error}`);
  return result.value;
}

/** The lifecycle use cases wired to the alerting tables, the audit trail, identity's view of who is who and messaging's outbox. */
export function createAlerting(wiring: AlertingWiring): AlertLifecycle {
  const queue = createDeliveryQueue();
  return createAlertLifecycle({
    db: wiring.db,
    audit: wiring.audit ?? { record: (tx, event) => audit.record(tx, event), recordRefusal: (db, event) => audit.recordRefusal(db, event) },
    staff: wiring.staff ?? { standing: readStaffStanding },
    // The buildings, floors and neighbourhoods an audience may name, read through the use case's own transaction.
    places: wiring.places ?? { floorsOf: floorsOfBuilding, neighbourhoodIds, neighbourhoodsOf: neighbourhoodsOfBuildings },
    now: wiring.now,
    newId: wiring.newId,
    newSlug: wiring.newSlug,
    latestValidUntil: wiring.latestValidUntil,
    // The approval's seams (S04.07 with S06.01). `recipients` is subscriptions' count and capture port (E07 fills it in, in subscriptions; nothing
    // here changes): it says who gets a text and in which language, and writes nothing. The rest is the outbox, reached only through messaging's
    // public index, inside the approval's transaction: `markApproval` is `createDeliveryQueue().markApprovalTransaction(tx, entryId)`, which runs
    // before anyone is captured; `queueAlertTexts` is `enqueueAlertDeliveries(tx, entryId, texts)`, the only way an alert delivery is written, with
    // the entry's frozen body and segments for each person's language; the number of texts it returns is the recipient count the approval audits.
    recipients: wiring.recipients,
    markApproval: wiring.markApproval ?? (async (tx, entryId) => void settled(await queue.markApprovalTransaction(tx, entryId), "the approval marker")),
    queueAlertTexts:
      wiring.queueAlertTexts ??
      (async (tx, entryId, texts) => settled(await queue.enqueueAlertDeliveries(tx, entryId, texts), "the alert texts").map((queued) => ({ lang: queued.delivery.lang }))),
    pricePerSegmentCents: wiring.pricePerSegmentCents,
  });
}

export type {
  AlertLifecycle,
  ApprovalBinding,
  ApprovalOutcome,
  ApprovalRequest,
  AttemptView,
  EntryRef,
  EntryReview,
  EntryState,
  EntryView,
  IncidentRow,
  Incidents,
  LogDisruptionInput,
  NewAlertInput,
  ReviewAction,
  ReviewedText,
  SubmitMode,
  SubmitStart,
  ThreadView,
} from "./application/lifecycle";
export { previewSms, type PreviewContext } from "./application/previewSms";
export { createEntryPreparer, type EntryPreparerDeps, type EntryTranslator } from "./application/prepareEntry";
export { createSubmitter, refusalOfPreparationError, type AlertSubmitter, type SubmitReport, type SubmitterDeps } from "./application/submit";
export { ATTEMPT_KINDS, ATTEMPT_STALE_MS, ATTEMPT_STATES, ENTRY_CHANNELS, SUBMIT_KEY_PATTERN, isStaleAttempt, type AttemptKind, type AttemptState } from "./domain/submitAttempt";
export { audiencesOverlap, possibleDuplicateOf, type DuplicateCandidate, type NeighbourhoodOf } from "./domain/duplicates";

export interface FeedWiring {
  /** Required unless both `version` and `places` are given. */
  db?: Db;
  /** Test and local-development seam: the places the feed lists, instead of the places module's. */
  places?: () => Promise<FeedPlaces>;
  /** Test and local-development seam: the feed version, instead of the database's. */
  version?: () => Promise<number>;
  /** The alerts residents are told. Until S04.08 builds the web publish, none. */
  alerts?: FeedAlerts;
  now?: () => Date;
}

/** `GET /api/feed` (AD-17): FeedV1 from the feed version, the places module's buildings and neighbourhoods, and the alerts. */
export function createFeed(wiring: FeedWiring): FeedReader {
  return createFeedReader({
    db: wiring.db,
    places: wiring.places ?? (() => createResidentBuildings({ db: requireDb(wiring.db) }).placeIds()),
    version: wiring.version,
    alerts: wiring.alerts,
    now: wiring.now,
  });
}

export type { FeedAlerts, FeedPlaces, FeedReader } from "./application/feed";
export { NO_ALERTS_YET } from "./application/feed";
export { NO_STATUS, type PlaceState } from "./domain/feed";
export type { AudienceFloor, AudiencePlaces, BuildingChoice, PlaceChoice } from "./application/audience";
export type { AlertActor, AlertAudit, AlertResult, RefusalDetail, EntryPreparer, FreezeRefusal, FrozenContent, FrozenSmsBody, PrepareContext, PrepareHooks, StaffDirectory } from "./application/ports";
export { FROZEN_LANGS, TranslationSetError, freezeTranslations, translatedToFrozen, type FrozenConversion, type FrozenTranslation } from "./domain/translations";
export {
  ALERT_TEXT_MAX,
  NEIGHBOURHOOD_ONLY_TYPES,
  PHASES,
  UNTIL_RESOLVED_MS,
  VALID_UNTIL_MAX_DAYS,
  audienceBuildings,
  contentRefusal,
  draftFingerprint,
  isWideContent,
  sameContent,
  validUntilRefusal,
  type ContentRefusal,
  type EntryContent,
  type Phase,
  type ValidUntilMode,
  type ValidUntilRefusal,
} from "./domain/content";
export {
  AUTHORED_KINDS,
  EDITING_RETURN_REASONS,
  ENTRY_KINDS,
  ENTRY_STATUSES,
  ENTRY_TRANSITIONS,
  RETURN_REASONS,
  checkApproval,
  isFinal,
  requestTransition,
  type ApprovalFacts,
  type ApprovalRefusal,
  type EntryKind,
  type EntryStatus,
  type ReturnReason,
  type TransitionAction,
  type TransitionDecision,
  type TransitionRefusal,
  type TransitionRequest,
  type TransitionRule,
} from "./domain/lifecycle";
export { freezeContent, type FreezeInput, type FreezeResult } from "./application/freezeContent";
export { canonicalContent, contentHash, contentHashInput, type ContentHashInput, type HashedEntry, type HashedSmsBody, type HashedWebText } from "./domain/hash";
export type { AlertRefusal } from "./domain/refusals";
