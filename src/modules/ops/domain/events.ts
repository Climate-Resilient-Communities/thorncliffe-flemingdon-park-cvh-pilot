// The operational events (AD-23): what the health job and the weekly review read. Each kind has its own strict
// `detail` schema (a field that is not listed rejects the event), none has a free-text field, and every value is
// a code or a count, so personal data has nowhere to go. Later stories add their kinds here.
import { z } from "zod";

const count = z.number().int().nonnegative().max(1_000_000);
const code = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

/** Why a directory publish failed (S02.05): the Admin's "Publish failed" names it. */
export const PUBLISH_FAILURE_REASONS = [
  "storage_unavailable",
  "invalid_catalogue",
  "catalogue_unreadable",
  "catalogue_not_loaded",
  "search_mismatch",
  "embedding_unavailable",
  "usage_allowance_exceeded",
  "search_config_invalid",
  "search_not_configured",
  "gave_up",
  "unexpected",
] as const;
export type PublishFailureReason = (typeof PUBLISH_FAILURE_REASONS)[number];

/** Why a search could not answer (S03.04): the stage and how it ended (`rate_limit_failed`: the per-client count could not be made). Never the question. */
export const SEARCH_FAILURE_REASONS = ["snapshot_failed", "embed_failed", "embed_invalid", "timed_out", "rate_limit_failed"] as const;
export type SearchFailureReason = (typeof SEARCH_FAILURE_REASONS)[number];

/** Which vendor call of a search leg failed while the search still answered (S03.05): the embedding, or the question's translation. */
export const SEARCH_LEG_FAILURE_REASONS = ["embed_failed", "translate_failed"] as const;

/**
 * Why a delivery became `unknown` (S06.02): an ambiguous answer from the provider, or a row the sweep found with no outcome.
 * The same codes as messaging's UNKNOWN_CAUSES (a test in src/app compares them; ops may not import messaging's domain).
 */
export const DELIVERY_UNKNOWN_CAUSES = [
  "server_error",
  "rate_limited_without_error_body",
  "unexpected_status",
  "timeout",
  "connection_lost",
  "unusable_response",
  "accepted_then_dropped",
  "accepted_then_error",
  "provider_threw",
  "no_outcome_after_hand_off",
  "no_terminal_status",
] as const;

export const OPS_EVENT_KINDS = {
  /**
   * A delivery became `unknown` (S06.02): the provider's answer was ambiguous, or the sweep found no outcome for a hand-off (5 minutes) or
   * no terminal status for a `submitted` text (24 hours). It is never sent again automatically and may or may not have arrived; a late
   * callback can still resolve it (S06.04). Subject: the delivery. The health job alerts the on-call Admin (S06.07). Codes only.
   */
  "delivery.unknown": {
    severity: "error",
    detail: z.strictObject({
      cause: z.enum(DELIVERY_UNKNOWN_CAUSES),
      http_status: z.number().int().min(100).max(599).optional(),
    }),
  },
  /** The provider refused the credentials (HTTP 401 or 403) several texts in a row, so the run stopped (S06.02); the texts that were refused are `failed`. */
  "dispatch.provider_auth_failed": {
    severity: "error",
    detail: z.strictObject({ http_status: z.number().int().min(400).max(499) }),
  },
  /** The daily check found Smart Encoding on in the Twilio Messaging Service (S06.02): the on-call Admin is alerted (S06.07). */
  "messaging.smart_encoding_on": {
    severity: "error",
    detail: z.strictObject({}),
  },
  /** The daily check could not read the Messaging Service's setting (S06.02), so it cannot say Smart Encoding is off. A code only. */
  "messaging.service_check_failed": {
    severity: "warning",
    detail: z.strictObject({ reason: code }),
  },
  /** A directory publish gave up: the previous release stays current. Subject: the release (`directory_release`, its number) when one exists. */
  "directory.publish_failed": {
    severity: "error",
    detail: z.strictObject({
      reason: z.enum(PUBLISH_FAILURE_REASONS),
      attempts: count,
      /** Files of the release already in Storage when it gave up. */
      files_stored: count.optional(),
      stage: code.optional(),
    }),
  },
  /** A search answered `search_unavailable` (S03.04): no leg completed. Subject: the release it ran on, when it had one. Counts and codes only. */
  "search.unavailable": {
    severity: "warning",
    detail: z.strictObject({
      reason: z.enum(SEARCH_FAILURE_REASONS),
      /** How long the request had run when it gave up. */
      ms: count,
    }),
  },
  /** A vendor call of one search leg failed (an embedding, or the translation of a question) although the other leg answered, so the search did not fail and nothing else would show it. At most one per reason a minute. Counts and codes only. */
  "search.leg_failed": {
    severity: "warning",
    detail: z.strictObject({
      reason: z.enum(SEARCH_LEG_FAILURE_REASONS),
      ms: count,
    }),
  },
} as const;

export type OpsEventKind = keyof typeof OPS_EVENT_KINDS;
export type OpsEventDetail<K extends OpsEventKind> = z.input<(typeof OPS_EVENT_KINDS)[K]["detail"]>;

export class OpsEventError extends Error {
  override name = "OpsEventError";
}

export interface OpsEvent<K extends OpsEventKind = OpsEventKind> {
  kind: K;
  subjectType?: string;
  subjectId?: string;
  detail: OpsEventDetail<K>;
}

export interface OpsEventRecord {
  kind: OpsEventKind;
  severity: "info" | "warning" | "error";
  subjectType: string | null;
  subjectId: string | null;
  detail: Record<string, unknown>;
}

/** Validates an event and turns it into the row to store, or throws OpsEventError (a bug in the caller, not an input). */
export function toOpsEventRecord<K extends OpsEventKind>(event: OpsEvent<K>): OpsEventRecord {
  const kind = OPS_EVENT_KINDS[event.kind];
  if (!kind) throw new OpsEventError("Unknown ops event kind");
  const parsed = kind.detail.safeParse(event.detail);
  if (!parsed.success) throw new OpsEventError(`${event.kind}: detail is invalid (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")})`);
  return {
    kind: event.kind,
    severity: kind.severity,
    subjectType: event.subjectType ?? null,
    subjectId: event.subjectId ?? null,
    detail: parsed.data,
  };
}
