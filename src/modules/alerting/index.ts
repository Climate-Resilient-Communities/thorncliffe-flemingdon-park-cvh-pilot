// The alerting module's public interface (AD-2, AD-5): alert threads and their entries, and the one
// lifecycle they follow. Other modules and the app use only what is exported here.
import type { Db } from "../../platform/db";
import { readStaffStanding } from "../identity";
import { floorsOfBuilding, neighbourhoodIds, neighbourhoodsOfBuildings } from "../places";
import * as audit from "../audit";
import { recordOpsEvent, type OpsEvent } from "../ops";
import { createAlertLifecycle, type AlertLifecycle, type AlertLifecycleDeps } from "./application/lifecycle";
import { createEntryPreparer, type EntryTranslator } from "./application/prepareEntry";
import { createSubmitter, type AlertSubmitter } from "./application/submit";
import type { FreezeResult } from "./application/ports";
import type { FreezeInput } from "./application/freezeContent";

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

/** The lifecycle use cases wired to the alerting tables, the audit trail and identity's view of who is who. */
export function createAlerting(wiring: AlertingWiring): AlertLifecycle {
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
  });
}

export type {
  AlertLifecycle,
  ApprovalBinding,
  AttemptView,
  EntryRef,
  EntryState,
  EntryView,
  LogDisruptionInput,
  NewAlertInput,
  SubmitMode,
  SubmitStart,
  ThreadView,
} from "./application/lifecycle";
export { previewSms, type PreviewContext } from "./application/previewSms";
export { createEntryPreparer, type EntryPreparerDeps, type EntryTranslator } from "./application/prepareEntry";
export { createSubmitter, refusalOfPreparationError, type AlertSubmitter, type SubmitReport, type SubmitterDeps } from "./application/submit";
export { ATTEMPT_KINDS, ATTEMPT_STALE_MS, ATTEMPT_STATES, ENTRY_CHANNELS, SUBMIT_KEY_PATTERN, isStaleAttempt, type AttemptKind, type AttemptState } from "./domain/submitAttempt";
export { audiencesOverlap, possibleDuplicateOf, type DuplicateCandidate, type NeighbourhoodOf } from "./domain/duplicates";
export type { AudienceFloor, AudiencePlaces, BuildingChoice, PlaceChoice } from "./application/audience";
export type { AlertActor, AlertAudit, AlertResult, EntryPreparer, FreezeRefusal, FrozenContent, FrozenSmsBody, PrepareContext, PrepareHooks, StaffDirectory } from "./application/ports";
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
