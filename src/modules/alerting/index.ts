// The alerting module's public interface (AD-2, AD-5): alert threads and their entries, and the one
// lifecycle they follow. Other modules and the app use only what is exported here.
import type { Db } from "../../platform/db";
import { readStaffStanding } from "../identity";
import { createResidentBuildings, floorsOfBuilding, neighbourhoodIds } from "../places";
import * as audit from "../audit";
import { createFeedReader, requireDb, type FeedAlerts, type FeedPlaces, type FeedReader } from "./application/feed";
import { createAlertLifecycle, type AlertLifecycle, type AlertLifecycleDeps } from "./application/lifecycle";

export interface AlertingWiring {
  db: Db;
  /** Test seams. */
  now?: AlertLifecycleDeps["now"];
  newId?: AlertLifecycleDeps["newId"];
  audit?: AlertLifecycleDeps["audit"];
  staff?: AlertLifecycleDeps["staff"];
  places?: AlertLifecycleDeps["places"];
}

/** The lifecycle use cases wired to the alerting tables, the audit trail and identity's view of who is who. */
export function createAlerting(wiring: AlertingWiring): AlertLifecycle {
  return createAlertLifecycle({
    db: wiring.db,
    audit: wiring.audit ?? { record: (tx, event) => audit.record(tx, event), recordRefusal: (db, event) => audit.recordRefusal(db, event) },
    staff: wiring.staff ?? { standing: readStaffStanding },
    // The buildings, floors and neighbourhoods an audience may name, read through the use case's own transaction.
    places: wiring.places ?? { floorsOf: floorsOfBuilding, neighbourhoodIds },
    now: wiring.now,
    newId: wiring.newId,
  });
}

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
export type { AlertLifecycle, ApprovalBinding, EntryRef, EntryView, NewAlertInput, ThreadView } from "./application/lifecycle";
export type { AudienceFloor, AudiencePlaces, BuildingChoice, PlaceChoice } from "./application/audience";
export type { AlertActor, AlertAudit, AlertResult, EntryPreparer, FrozenContent, FrozenSmsBody, FrozenTranslation, StaffDirectory } from "./application/ports";
export {
  ALERT_TEXT_MAX,
  NEIGHBOURHOOD_ONLY_TYPES,
  PHASES,
  VALID_UNTIL_MAX_MS,
  audienceBuildings,
  contentRefusal,
  isWideContent,
  sameContent,
  validUntilRefusal,
  type ContentRefusal,
  type EntryContent,
  type Phase,
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
