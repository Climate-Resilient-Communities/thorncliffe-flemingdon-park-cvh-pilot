// The operational events (AD-23): what the health job and the weekly review read. Each kind has its own strict
// `detail` schema (a field that is not listed rejects the event), none has a free-text field, and every value is
// a code or a count, so personal data has nowhere to go. Later stories add their kinds here.
import { z } from "zod";
import { SafeErrorSchema } from "@/contracts/safeError";

const count = z.number().int().nonnegative().max(1_000_000);
// A classification of a failure: a SQLSTATE, a class name, `timed_out`, `translate_failed:quota` or
// `listing_schema:providers.0.field`. A few shapes of one token (or a code and a detail), never a message, an address or a hash
// (src/contracts/safeError.ts is the one definition of them).
const safeError = SafeErrorSchema;
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

/**
 * Why a search could not answer (S03.04): the stage and how it ended (`rate_limit_failed`: the per-client count could not be
 * made; `deadline`: the route's hard deadline, 2.5 s from the request start, came while something was still pending, and the
 * route answered 503 then). Never the question.
 */
export const SEARCH_FAILURE_REASONS = ["snapshot_failed", "embed_failed", "embed_invalid", "timed_out", "rate_limit_failed", "deadline"] as const;
export type SearchFailureReason = (typeof SEARCH_FAILURE_REASONS)[number];

/**
 * Which vendor call of a search leg failed while the search still answered (S03.05): the embedding, or the question's
 * translation. `translate_quota`: the translation model is past the vendor's limit (someone must act on the key or the
 * route); `translate_fallback_used`: the fallback model rescued a translation the routed model could not make;
 * `translate_quota_near`: the month's translate calls of a model have reached 80% of the limit configured for it
 * (`SEARCH_TRANSLATE_MONTHLY_CALLS`), a warning before the 429s begin (no search failed: `ms` is 0).
 */
export const SEARCH_LEG_FAILURE_REASONS = ["embed_failed", "translate_failed", "translate_quota", "translate_fallback_used", "translate_quota_near"] as const;

/** A vendor model id (not personal data): the shape the config accepts for SEARCH_QUESTION_ROUTE and the fallback. */
const modelId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);

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
      /** What failed: `timed_out`, a Postgres SQLSTATE, an error class name or a schema path (`listing_schema:providers.0.neighbourhood_ids`). Never a message. */
      error: safeError.optional(),
    }),
  },
  /** A vendor call of one search leg failed (an embedding, or the translation of a question) although the other leg answered, so the search did not fail and nothing else would show it (or, `translate_quota_near`, a translation model is near its configured monthly limit). At most one per reason and model a minute (the near-limit warning once a month per model and instance). Counts and codes only. */
  "search.leg_failed": {
    severity: "warning",
    detail: z.strictObject({
      reason: z.enum(SEARCH_LEG_FAILURE_REASONS),
      ms: count,
      /** The model whose call failed (or, for `translate_fallback_used`, the fallback that answered; for `translate_quota_near`, the model near its limit). */
      model: modelId.optional(),
      /** What failed: a translation call's class (`translate_failed:quota`), a Postgres SQLSTATE or an error class name. Never a message. Absent for the fallback and the near-limit warning (nothing failed). */
      error: safeError.optional(),
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
