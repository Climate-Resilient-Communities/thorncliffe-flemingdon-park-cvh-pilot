// The ops module's public interface (AD-2, AD-23): the operational event log. Other modules and the app write ops events
// only through recordOpsEvent (or recordOpsEventUnlessBusy, for an event anyone can cause); the health job (E09) reads them.
export { recordOpsEvent, recordOpsEventUnlessBusy } from "./application/recordOpsEvent";
export {
  ALERT_SUBMIT_FAILURE_REASONS,
  CALLBACK_IGNORED_REASONS,
  DELIVERY_UNKNOWN_CAUSES,
  OPS_EVENT_KINDS,
  OpsEventError,
  PUBLISH_FAILURE_REASONS,
  SEARCH_FAILURE_REASONS,
  SIGNATURE_FAILURE_REASONS,
  UNKNOWN_RESOLVED_STATUSES,
  WEBHOOK_ROUTES,
  toOpsEventRecord,
  type AlertSubmitFailureReason,
  type OpsEvent,
  type OpsEventKind,
  type PublishFailureReason,
  type SearchFailureReason,
} from "./domain/events";
