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

// S06.07: the on-call roster, the health job and the Hub's banner for a sender that is failing (composed in src/app/health.ts and src/app/oncall.ts); S08.08
// the on-duty Admin and whom an escalation's text goes to (composed in src/app/escalations.ts).
export {
  createOncallRoster,
  escalationRecipients,
  hasOncallNumber,
  onDutyStateOf,
  oncallNumberSource,
  type AddOutcome,
  type EscalationRecipientIds,
  type OnDutyAdminCheck,
  type OnDutyOutcome,
  type OnDutyState,
  type OncallEntry,
  type OncallRoster,
  type OncallRosterDeps,
  type RemoveOutcome,
} from "./application/oncallRoster";
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
  type HeartbeatReading,
} from "./application/healthJob";
export { ONCALL_LABEL_MAX_CHARS, ONCALL_MAX_NUMBERS, parseOncallLabel, parseOncallNumber, type OncallRefusal } from "./domain/oncall";
export {
  ALERT_INTERVAL_MS,
  FALLBACK_WINDOW_MS,
  HEARTBEAT_CAUSES,
  HEARTBEAT_STALE_AFTER_MS,
  JOB_FAILURE_WINDOW_MS,
  PROVIDER_AUTH_RED_AFTER_MS,
  SENDER_CONDITIONS,
  SIGNATURE_FAILURE_LIMIT,
  SIGNATURE_WINDOW_MS,
  decide,
  heartbeatCause,
  heartbeatFresh,
  intervalPassed,
  type ConditionState,
  type Decision,
  type HeartbeatCause,
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

// S09.05: the pilot measures export (every Section 9 measure for the week-8 review, read by scripts/export-measures): the lines, the small-number rule the
// export applies, the CSV and the printable page, the two files it reads (the rehearsal alerts and the translation survey), and the ports for the measures of
// modules ops may not import, which the script wires.
export { pilotMeasuresExport, readPilotMeasures, type MeasurePorts, type PilotMeasures, type PilotMeasuresFiles, type PilotMeasuresRequest } from "./application/pilotMeasures";
export {
  CHECKIN_STATUSES,
  DIRECTORY_EVENTS,
  INSTALL_EVENTS,
  MEASURE_EDITIONS,
  MEASURE_SECTIONS,
  SPEND_SECTIONS,
  UNPROTECTED_COUNTS,
  editionHasSpend,
  measureLines,
  torontoDay,
  type AlertCostInput,
  type CoverageInput,
  type LeftOut,
  type MeasureEdition,
  type MeasureLine,
  type MeasureSection,
  type MeasuresInput,
  type SpendInput,
  type SubscriberDayInput,
} from "./domain/measureLines";
export { MEASURE_CSV_COLUMNS, SmallNumberLeak, assertSmallNumbersHidden, escapeHtml, measuresCsv, measuresHtml } from "./domain/measureExport";
export { MeasureFileError, REHEARSAL_ALERTS_HEADING, SURVEY_HEADER, SURVEY_LANGS, parseRehearsalAlerts, parseSurvey, type Survey, type SurveyCounts } from "./domain/measureFiles";
export { NOT_SHOWN, isSmall, shownCount, shownPercent, shownSplit, type Shown } from "./domain/smallNumbers";
