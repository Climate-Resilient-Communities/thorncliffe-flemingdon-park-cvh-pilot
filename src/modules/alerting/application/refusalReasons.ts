import type { REFUSAL_REASONS } from "../../audit";
import type { AlertRefusal } from "../domain/refusals";

type AuditReason = (typeof REFUSAL_REASONS)[number];

/** The audit reason of each refusal (the audit module's REFUSAL_REASONS). */
export const AUDIT_REASON: Record<AlertRefusal, AuditReason> = {
  ILLEGAL_TRANSITION: "conflict",
  ALERT_CLOSED: "alert_closed",
  WEB_PUBLISHED: "conflict",
  ENTRY_NOT_PENDING: "conflict",
  EDITOR_CANNOT_APPROVE: "self_action",
  ENTRY_CHANGED: "conflict",
  VALID_UNTIL_PAST: "validation",
  TEXT_EMPTY: "validation",
  TEXT_TOO_LONG: "validation",
  TYPES_EMPTY: "validation",
  TYPES_REPEATED: "validation",
  PHASE_INVALID: "validation",
  AUDIENCE_INVALID: "validation",
  NEIGHBOURHOOD_ONLY_TYPE: "validation",
  VALID_UNTIL_INVALID: "validation",
  VALID_UNTIL_TOO_FAR: "validation",
  NOT_ALLOWED: "forbidden",
  OUT_OF_SCOPE: "out_of_scope",
  AAL2_REQUIRED: "aal_required",
  AUTHOR_NOT_ALLOWED: "out_of_scope",
  ALERT_NOT_FOUND: "not_found",
  ENTRY_NOT_FOUND: "not_found",
  UNKNOWN_TYPE: "validation",
  DRAFT_CHANGED: "conflict",
  REPORTED_AT_INVALID: "validation",
  PREPARATION_FAILED: "provider_error",
  SMS_BODY_TOO_LONG: "validation",
  TRANSLATION_STALE: "conflict",
  ROUTES_UNAVAILABLE: "provider_error",
  ROUTES_INVALID: "provider_error",
  SUBMIT_IN_PROGRESS: "conflict",
  SUBMIT_KEY_INVALID: "validation",
  SUBMIT_ABANDONED: "conflict",
  AUDIENCE_EMPTY: "validation",
  NEIGHBOURHOOD_NOT_FOUND: "not_found",
  BUILDING_NOT_FOUND: "not_found",
  FLOOR_NOT_IN_BUILDING: "validation",
  FLOOR_RANGE_REVERSED: "validation",
  FLOOR_RANGE_INCOMPLETE: "validation",
  GROUP_UNKNOWN: "validation",
  RECIPIENT_COUNT_CHANGED: "conflict",
  NOTE_REQUIRED: "validation",
  NOTE_TOO_LONG: "validation",
  NO_PUBLISHED_ENTRY: "conflict",
  ENTRY_ID_INVALID: "validation",
  TYPES_CHANGED: "validation",
  TARGET_NOT_VALID: "conflict",
  TARGET_SUPERSEDED: "conflict",
  TARGET_NOT_PUBLISHED: "conflict",
  WITHDRAWAL_REASON_INVALID: "validation",
  ONCALL_REQUIRED: "setup_incomplete",
};

/** The forms of the approval view (S04.07), and the audited action each stands for. */
export type InvalidFormAction = "approve" | "return" | "discard";
export const INVALID_FORM_AUDIT_ACTION = { approve: "entry.approved", return: "entry.returned", discard: "entry.discarded" } as const satisfies Record<InvalidFormAction, string>;

/**
 * A form that does not carry what its action needs (the version and hash shown, the count reviewed) is refused before any use case runs; its record
 * says `validation` and this code. It is not a refusal a use case returns, so it is not an `AlertRefusal`.
 */
export const INVALID_FORM_REASON: AuditReason = "validation";
export const INVALID_FORM_CODE = "INVALID_FORM";
