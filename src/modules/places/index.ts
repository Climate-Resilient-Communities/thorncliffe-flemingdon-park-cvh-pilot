// The places module's public interface (AD-2, AD-25): the neighbourhoods, the pilot buildings and
// their floors. Other modules and the app use only what is exported here.
export { readBuildingsFixtureFile } from "./adapters/buildingsFixture";
export { readMergeFile, readRegisterFile } from "./adapters/registerFiles";
export { createBuildingService } from "./application/floors";
export type { BuildingContact, BuildingDetail, BuildingFacts, BuildingService, BuildingServiceDeps, BuildingSummary, FloorPlace, FloorRefusal, FloorResult, FloorView } from "./application/floors";
export { readPublicBuilding, type PublicBuilding } from "./application/publicBuilding";
export { BUILDINGS_SEED_CODE, BuildingImportRefusedError, importBuildings, type ImportCounts, type ImportDeps, type ImportResult } from "./application/importBuildings";
export { NO_ASSIGNMENTS, type AssignedAmbassador, type FloorAssignments, type PlacesAudit, type PlacesAuditAction, type PlacesAuditEvent } from "./application/ports";
export { CONTACT_OWNER, CONTACT_ROLE_MAX_LENGTH, checkContact, normalizePhone, telHref, trimContactRole, type ContactCheck, type ContactError } from "./domain/buildingContact";
export { FLOOR_LABEL_MAX_LENGTH, checkFloorLabel, floorLabelKey, trimFloorLabel, type FloorLabelCheck, type FloorLabelError } from "./domain/floorLabel";
export { formatImportReport } from "./domain/importReport";
export {
  PILOT_AREAS,
  formatProblem,
  parseMergeFile,
  planBuildingImport,
  type ImportPlan,
  type MergeEntry,
  type PilotArea,
  type PlanProblem,
  type PlannedBuilding,
} from "./domain/register";
