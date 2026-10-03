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

/**
 * Why a submit of an alert ended without freezing anything (S04.05): `translation_route` could not be read in time or holds a row that
 * is not a route (so nothing was translated and nothing half-made was frozen), a text message body was over the provider's limit in a
 * language, a translation was made from other English than the draft's, the translation or the freeze threw, or the freezing
 * transaction itself failed.
 */
export const ALERT_SUBMIT_FAILURE_REASONS = ["routes_unavailable", "routes_invalid", "sms_body_too_long", "translation_stale", "preparation_failed", "commit_failed"] as const;
export type AlertSubmitFailureReason = (typeof ALERT_SUBMIT_FAILURE_REASONS)[number];

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

/**
 * The conditions the health job watches (S06.07, AD-23) and raises the on-call alert for: texts queued and due for more than 5 minutes outside a
 * pause; a delivery that became `unknown` (or a hand-off the sweep could not settle); no sender running while texts are due; Smart Encoding found
 * on; and webhook signature failures past 5 in 10 minutes. The same codes as `health_condition.condition`.
 */
export const HEALTH_CONDITIONS = ["queue_stuck", "delivery_unknown", "sender_stalled", "smart_encoding_on", "signature_failures"] as const;
export type HealthCondition = (typeof HEALTH_CONDITIONS)[number];

/** The webhook routes whose signature failures are counted (S06.04; S07.04 adds `twilio_inbound`). */
export const WEBHOOK_ROUTES = ["twilio_status"] as const;

/** Why a webhook's signature was refused (S06.04): no `X-Twilio-Signature` header, or one that is not the request's signature. */
export const SIGNATURE_FAILURE_REASONS = ["missing_signature", "signature_mismatch"] as const;

/**
 * Why a validly signed status callback changed nothing and is counted (S06.04). The same codes as messaging's
 * `CALLBACK_IGNORED_REASONS` (a test in src/app compares them; ops may not import messaging's domain). `no_ref`: no delivery reference in
 * the URL; `unknown_ref`: a reference no delivery has (or one that cannot be a delivery's); `invalid_payload`: no usable MessageSid or
 * MessageStatus; `not_in_flight`: the delivery was never handed to the provider, or ended without a provider id.
 */
export const CALLBACK_IGNORED_REASONS = ["no_ref", "unknown_ref", "invalid_payload", "not_in_flight"] as const;

/** The state a callback moved an `unknown` delivery to (S06.04). The same codes as messaging's `CALLBACK_TARGETS` (compared by the same test). */
export const UNKNOWN_RESOLVED_STATUSES = ["submitted", "delivered", "undelivered", "failed"] as const;

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
  /**
   * A delivery that was `unknown` moved on because the provider's signed status callback arrived late (S06.04): `status` is the state it
   * moved to. The `delivery.unknown` of the same delivery is thereby resolved: the health job (S06.07) records the recovery from it.
   * Subject: the delivery. Codes only.
   */
  "delivery.unknown_resolved": {
    severity: "info",
    detail: z.strictObject({ status: z.enum(UNKNOWN_RESOLVED_STATUSES) }),
  },
  /**
   * A validly signed status callback changed nothing and is counted (S06.04): see CALLBACK_IGNORED_REASONS. Subject: the delivery,
   * when the callback named one. A repeat, a late non-terminal status or any status after a final one is ordinary and not recorded.
   */
  "delivery.callback_ignored": {
    severity: "warning",
    detail: z.strictObject({ reason: z.enum(CALLBACK_IGNORED_REASONS) }),
  },
  /**
   * A signed status callback carried a different provider id than the one the delivery already has (S06.04): nothing was changed,
   * because a provider id never changes. Subject: the delivery. The two ids are not recorded.
   */
  "delivery.provider_id_mismatch": {
    severity: "error",
    detail: z.strictObject({}),
  },
  /**
   * A webhook request whose signature was refused (S06.04, AD-23): more than 5 in 10 minutes raise the on-call alert (S06.07). The request
   * was answered 403 and did nothing else. Anyone can send such a request, so the app records at most a fixed number in any 10 minutes
   * (src/app/dispatch.ts): the count past the alert's threshold is what matters, not every attempt. Codes only: no address, no body.
   */
  "webhook.signature_invalid": {
    severity: "warning",
    detail: z.strictObject({ route: z.enum(WEBHOOK_ROUTES), reason: z.enum(SIGNATURE_FAILURE_REASONS) }),
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
  /** The daily check found Smart Encoding off (S06.02): the health job (S06.07) reads it as the end of an earlier "on". At most one a day. */
  "messaging.smart_encoding_off": {
    severity: "info",
    detail: z.strictObject({}),
  },
  /** The daily check could not read the Messaging Service's setting (S06.02), so it cannot say Smart Encoding is off. A code only. */
  "messaging.service_check_failed": {
    severity: "warning",
    detail: z.strictObject({ reason: code }),
  },
  /**
   * The health job found a condition and texted the on-call Admins (S06.07). `count` is how many things the condition counts (stuck texts, unknown
   * deliveries, failures; 1 for a setting), `notified` how many on-call numbers were queued a text (0 when the roster is empty: the Hub banner and this
   * event still record it), `first` whether the condition began with this run, `rate_limited` that a new episode began inside the 30-minute
   * text interval, so it is recorded here and nothing was texted (`notified` 0). Counts and codes only.
   */
  "health.condition_alerted": {
    severity: "error",
    detail: z.strictObject({ condition: z.enum(HEALTH_CONDITIONS), count, notified: count, first: z.boolean(), rate_limited: z.boolean().optional() }),
  },
  /** A condition the health job had raised no longer holds (S06.07); no further text is sent for it. */
  "health.condition_recovered": {
    severity: "info",
    detail: z.strictObject({ condition: z.enum(HEALTH_CONDITIONS) }),
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
  /** A submit of an alert froze nothing (S04.05): the entry stays a draft and the author was told why. Subject: the entry (`alert_entry`). Codes and counts only. */
  "alert.submit_failed": {
    severity: "error",
    detail: z.strictObject({
      reason: z.enum(ALERT_SUBMIT_FAILURE_REASONS),
      /** How long the attempt had run when it gave up. */
      ms: count,
    }),
  },
  /** An alert was submitted with one or more languages that fell back to the English text (S04.05, AD-23: "a translation falls back for a whole language"). Subject: the entry. Codes and counts only. */
  "alert.translation_fallback": {
    severity: "warning",
    detail: z.strictObject({
      /** How many of the languages alerts are translated into fell back. */
      languages: count,
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
