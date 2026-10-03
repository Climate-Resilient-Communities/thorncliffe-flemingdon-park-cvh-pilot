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

export const OPS_EVENT_KINDS = {
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
