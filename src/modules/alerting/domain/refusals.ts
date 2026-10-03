import type { ContentRefusal, ValidUntilRefusal } from "./content";
import type { ApprovalRefusal, TransitionRefusal } from "./lifecycle";

/**
 * Why a lifecycle use case did nothing (spine: Errors, expected outcomes are values). Each is
 * recorded as a refusal (S01.04) under the audit reason application/refusalReasons.ts gives it;
 * none carries text or input.
 */
export type AlertRefusal =
  | TransitionRefusal
  | ApprovalRefusal
  | ContentRefusal
  | ValidUntilRefusal
  /** The person's role never may (the policy's `forbidden`). */
  | "NOT_ALLOWED"
  /** The role may, but not on this entry or these buildings. */
  | "OUT_OF_SCOPE"
  /** A privileged action from a session below aal2. */
  | "AAL2_REQUIRED"
  /** The author is no longer active, or no longer may author this entry (current status and assignments). */
  | "AUTHOR_NOT_ALLOWED"
  | "ALERT_NOT_FOUND"
  | "ENTRY_NOT_FOUND"
  | "UNKNOWN_TYPE"
  /** The draft changed since the content was prepared: nothing was frozen. */
  | "DRAFT_CHANGED"
  /** The time of the first report is not a time, or is in the future. */
  | "REPORTED_AT_INVALID"
  /** Translating, rendering or hashing the draft failed: the entry stays a draft. */
  | "PREPARATION_FAILED"
  /**
   * S04.05, a submit that was refused before anything was frozen (the entry stays a draft):
   *  - a text message body over Twilio's 1600 characters in one language, or a translation made from other English than the draft (S04.06);
   *  - `translation_route` could not be read in time, or holds a row that is not a route (S04.02's AlertRoutesUnavailableError and RouteConfigError);
   *  - another attempt is running on the entry, the key is not one a browser makes, or the attempt that held the key never finished.
   */
  | "SMS_BODY_TOO_LONG"
  | "TRANSLATION_STALE"
  | "ROUTES_UNAVAILABLE"
  | "ROUTES_INVALID"
  | "SUBMIT_IN_PROGRESS"
  | "SUBMIT_KEY_INVALID"
  | "SUBMIT_ABANDONED"
  /** The audience (S04.04): nothing chosen, a place that is not there, a floor not in its building, a bad range, a group nobody offers. */
  | "AUDIENCE_EMPTY"
  | "NEIGHBOURHOOD_NOT_FOUND"
  | "BUILDING_NOT_FOUND"
  | "FLOOR_NOT_IN_BUILDING"
  | "FLOOR_RANGE_REVERSED"
  | "FLOOR_RANGE_INCOMPLETE"
  | "GROUP_UNKNOWN";
