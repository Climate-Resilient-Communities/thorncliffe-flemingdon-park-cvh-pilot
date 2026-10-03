// The ops module's public interface (AD-2, AD-23): the operational event log. Other modules and the app write ops events
// only through recordOpsEvent (or recordOpsEventUnlessBusy, for an event anyone can cause). The health job (S06.07) judges the five sending conditions
// and texts the on-call roster; E09's weekly review reads the events.
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
export { activeSenderConditions, createHealthJob, oncallText, type ConditionReport, type HealthJob, type HealthJobDeps, type HealthReport } from "./application/healthJob";
export { ONCALL_LABEL_MAX_CHARS, ONCALL_MAX_NUMBERS, parseOncallLabel, parseOncallNumber, type OncallRefusal } from "./domain/oncall";
export { ALERT_INTERVAL_MS, SENDER_CONDITIONS, SIGNATURE_FAILURE_LIMIT, SIGNATURE_WINDOW_MS, decide, intervalPassed, type ConditionState, type Decision, type Observation } from "./domain/health";
