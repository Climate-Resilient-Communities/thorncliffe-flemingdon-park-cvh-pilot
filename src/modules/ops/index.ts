// The ops module's public interface (AD-2, AD-23): the operational event log. Other modules and the app write ops events
// only through recordOpsEvent (or recordOpsEventUnlessBusy, for an event anyone can cause). The health job (S06.07, S09.01) judges every AD-23
// condition, texts the on-call roster and records its heartbeat for the outside check; E09's weekly review reads the events.
export { recordOpsEvent, recordOpsEventUnlessBusy } from "./application/recordOpsEvent";
export {
  ALERT_SUBMIT_FAILURE_REASONS,
  CALLBACK_IGNORED_REASONS,
  DELIVERY_UNKNOWN_CAUSES,
  HEALTH_CONDITIONS,
  OPS_EVENT_KINDS,
  OpsEventError,
  PUBLISH_FAILURE_REASONS,
  SEARCH_FAILURE_REASONS,
  SIGNATURE_FAILURE_REASONS,
  UNKNOWN_RESOLVED_STATUSES,
  WEBHOOK_ROUTES,
  toOpsEventRecord,
  type AlertSubmitFailureReason,
  type HealthCondition,
  type OpsEvent,
  type OpsEventKind,
  type PublishFailureReason,
  type SearchFailureReason,
} from "./domain/events";

// S06.07: the on-call roster, the health job and the Hub's banner for a sender that is failing (composed in src/app/health.ts and src/app/oncall.ts).
export { createOncallRoster, hasOncallNumber, oncallNumberSource, type AddOutcome, type OncallEntry, type OncallRoster, type OncallRosterDeps, type RemoveOutcome } from "./application/oncallRoster";
export {
  activeHealthConditions,
  createHealthJob,
  oncallText,
  readHeartbeat,
  type ActiveCondition,
  type ConditionReport,
  type HealthJob,
  type HealthJobDeps,
  type HealthReport,
} from "./application/healthJob";
export { ONCALL_LABEL_MAX_CHARS, ONCALL_MAX_NUMBERS, parseOncallLabel, parseOncallNumber, type OncallRefusal } from "./domain/oncall";
export {
  ALERT_INTERVAL_MS,
  FALLBACK_WINDOW_MS,
  HEARTBEAT_STALE_AFTER_MS,
  JOB_FAILURE_WINDOW_MS,
  SENDER_CONDITIONS,
  SIGNATURE_FAILURE_LIMIT,
  SIGNATURE_WINDOW_MS,
  decide,
  heartbeatFresh,
  intervalPassed,
  type ConditionState,
  type Decision,
  type Observation,
} from "./domain/health";

// S09.04: the weekly reliability review (the SQL view `weekly_review`, read by scripts/export-weekly).
export { readWeeklyReview, weeklyReviewExport } from "./application/weeklyReview";
export {
  FEWER_THAN_FIVE,
  WEEKLY_CSV_COLUMNS,
  WEEKLY_SECTIONS,
  csvCell,
  isWeekStart,
  lastFullWeek,
  sortWeeklyRows,
  weeklyReviewCsv,
  type WeeklyRow,
  type WeeklySection,
} from "./domain/weeklyReview";
