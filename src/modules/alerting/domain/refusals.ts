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
  | "PREPARATION_FAILED";
