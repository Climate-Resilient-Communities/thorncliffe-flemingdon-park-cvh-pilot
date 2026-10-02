// The ops module's public interface (AD-2, AD-23): the operational event log. Other modules and the app write ops events
// only through recordOpsEvent; the health job (E09) reads them.
export { recordOpsEvent } from "./application/recordOpsEvent";
export {
  OPS_EVENT_KINDS,
  OpsEventError,
  PUBLISH_FAILURE_REASONS,
  toOpsEventRecord,
  type OpsEvent,
  type OpsEventKind,
  type PublishFailureReason,
} from "./domain/events";
