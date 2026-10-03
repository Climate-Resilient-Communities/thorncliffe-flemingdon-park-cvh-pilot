// The alerting module's public interface (AD-2, AD-5): alert threads and their entries, and the one
// lifecycle they follow. Other modules and the app use only what is exported here.
import type { Db } from "../../platform/db";
import { readStaffStanding } from "../identity";
import { floorsOfBuilding, neighbourhoodIds } from "../places";
import * as audit from "../audit";
import { createAlertLifecycle, type AlertLifecycle, type AlertLifecycleDeps } from "./application/lifecycle";

/** What the sender's hand-off point reads about an alert delivery's entry and thread (messaging's AlertStandingReader port, S06.02). */
export { alertStandingReader, isClosingEntry } from "./adapters/handOffStanding";

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
export type { AlertRefusal } from "./domain/refusals";
