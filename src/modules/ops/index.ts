// The ops module's public interface (AD-2, AD-23): the operational event log. Other modules and the app write ops events
// only through recordOpsEvent; the health job (E09) reads them.
export { recordOpsEvent } from "./application/recordOpsEvent";
export {
  DELIVERY_UNKNOWN_CAUSES,
  OPS_EVENT_KINDS,
  OpsEventError,
  PUBLISH_FAILURE_REASONS,
  SEARCH_FAILURE_REASONS,
  toOpsEventRecord,
  type OpsEvent,
  type OpsEventKind,
  type PublishFailureReason,
  type SearchFailureReason,
} from "./domain/events";
