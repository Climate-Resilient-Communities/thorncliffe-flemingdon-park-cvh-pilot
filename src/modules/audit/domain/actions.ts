import { z } from "zod";
import { isIsoDate } from "@/contracts/contentReview";
import { STAFF_ROLES } from "../../../contracts/staffRoles";

/**
 * The audit actions and the allow-listed `meta` of each (S01.04, AD-13, AD-14).
 *
 * Every schema is strict: a field that is not listed rejects the record. No
 * schema has a free-text field, so passwords, tokens, authenticator secrets,
 * phone numbers, email addresses and message bodies have nowhere to go; the
 * person is identified only by `actorStaffId` and the subject by type and id.
 * `findSensitiveValue` is a second, defensive check on the values themselves.
 *
 * Later epics add their actions here (each with its own strict schema).
 */

export { STAFF_ROLES };

/**
 * The actor of what the system does by itself: scripts run by IT
 * (scripts/create-first-admin), jobs, and sign-in attempts for usernames that
 * match no account. It is stored as a null actor_staff_id.
 */
export const SYSTEM_ACTOR = null;

/**
 * Why an authenticator was reset (S01.11), a fixed list because audit meta has no free text:
 * `lost_device` is the reason of an Admin's "Reset authenticator" and one IT may name;
 * `all_admins_lost_access` is IT's reason when no usable Admin can sign in (scripts/recover-admin).
 */
export const FACTOR_RESET_REASONS = ["lost_device", "device_broken", "all_admins_lost_access"] as const;

/** Why an action was refused or failed: a code, never a message or an input. */
export const REFUSAL_REASONS = [
  "wrong_password",
  /** A wrong authenticator code (S01.10). */
  "wrong_code",
  "unknown_username",
  "throttled",
  "locked",
  "expired_starting_password",
  "unauthenticated",
  "forbidden",
  "out_of_scope",
  "aal_required",
  "setup_incomplete",
  "bootstrap_incomplete",
  "two_admin_rule",
  "self_action",
  "duplicate",
  "validation",
  /** A staff request whose facts the guard could not read (a malformed body): a 400. */
  "bad_request",
  "not_found",
  "conflict",
  "floor_has_assignments",
  "not_allowlisted",
  "provider_error",
  /** S01.15: the test text cannot be sent here (not production with SMS_MODE live, or Twilio not set up). */
  "not_available",
  /** A change to a thread that is closed (S04.03, ALERT_CLOSED). */
  "alert_closed",
] as const;

const ROUTE_PATTERN = /^(\/([a-z][a-z-]*|\[[a-z_]+\]))+$/;

const role = z.enum(STAFF_ROLES);
const id = z.uuid();
const count = z.number().int().nonnegative().max(1_000_000);
const flag = z.boolean();
/**
 * S01.06: a recovery action or automatic lock that left fewer than two usable Admins. Present only
 * then, and only as `true` (identity's adminShortfallMeta).
 */
const adminShortfall = z.literal(true);
/** A lower_snake_case code (seed names, count keys, provider status). */
const code = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
/** A real calendar date written YYYY-MM-DD (a provider's last-confirmed date): 2026-02-31 is refused. */
const isoDate = z.string().refine(isIsoDate, "must be a real date written YYYY-MM-DD");
/** The City register's building number. */
const rsn = z.string().regex(/^[0-9]{1,9}$/);
/** A floor label as S01.13 allows it. */
const floorLabel = z.string().regex(/^[A-Za-z0-9 -]{1,8}$/);
/** A SHA-256 as 64 lower-case hex digits (an entry's content hash). */
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
/** An alert entry's kind (AD-5). */
const entryKind = z.enum(["ack", "update", "correction", "withdrawal", "final"]);
/** A policy action name such as `alert.approve`. */
const permission = z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){0,3}$/).max(64);
/**
 * A route pattern such as `/api/staff/accounts/[id]`: segments are lowercase
 * words or `[param]` placeholders, so a phone number, a username or a token
 * cannot be a segment (dynamic segments as patterns, never values).
 */
const route = z.string().regex(ROUTE_PATTERN).max(120);

/** Fields every action may carry. */
const common = {
  /** Set on `refused` records: why. */
  reason: z.enum(REFUSAL_REASONS).optional(),
};

const meta = <T extends z.ZodRawShape>(shape: T) => z.strictObject({ ...common, ...shape });

export const AUDIT_META = {
  // Accounts (S01.05, S01.06, S01.08, S01.10)
  "account.created": meta({ role: role.optional(), bootstrap: flag.optional() }),
  "account.suspended": meta({ role: role.optional() }),
  "account.removed": meta({ role: role.optional() }),
  "account.role_changed": meta({ from: role.optional(), to: role.optional() }),
  "bootstrap.completed": meta({}),

  // Passwords (S01.07, S01.08). `reissued` restarts an expired starting password's 24 hours.
  "password.changed": meta({}),
  "password.reset": meta({ admin_shortfall: adminShortfall.optional() }),
  "password.reissued": meta({ admin_shortfall: adminShortfall.optional() }),

  // Authenticators (S01.10, S01.11)
  "factor.enrolled": meta({}),
  "factor.reset": meta({
    admin_shortfall: adminShortfall.optional(),
    recovery: z.enum(FACTOR_RESET_REASONS).optional(),
    /** IT's scripts/recover-admin run with --confirm-no-admin-can-sign-in: the operator attested that no Admin can sign in. */
    attested: z.literal(true).optional(),
  }),

  // Sign-in and sessions (S01.07, S01.08, S01.10)
  "auth.signed_in": meta({ aal: z.enum(["aal1", "aal2"]).optional() }),
  "auth.failed": meta({ attempts: count.optional() }),
  "auth.locked": meta({
    lock: z.enum(["failed_sign_in", "expired_starting_password"]),
    admin_shortfall: adminShortfall.optional(),
  }),
  "session.revoked": meta({
    cause: z.enum(["suspended", "removed", "password_reset", "factor_reset", "role_changed"]),
    sessions: count.optional(),
  }),
  "permission.denied": meta({
    status: z.union([z.literal(400), z.literal(401), z.literal(403)]),
    permission: permission.optional(),
    route: route.optional(),
  }),

  // Buildings and floors (S01.13)
  "building.floor_added": meta({ floor_id: id.optional(), label: floorLabel.optional() }),
  "building.floor_renamed": meta({ floor_id: id.optional(), from: floorLabel.optional(), to: floorLabel.optional() }),
  "building.floor_removed": meta({ floor_id: id.optional(), label: floorLabel.optional(), assignments: count.optional() }),
  "building.confirmed": meta({ floors: count.optional() }),

  // Ambassador assignments (S01.14). `floor_ids: null` is the whole building.
  "assignment.saved": meta({ staff_id: id.optional(), rsn: rsn.optional(), floor_ids: z.array(id).max(200).nullable().optional() }),
  "assignment.removed": meta({ staff_id: id.optional(), rsn: rsn.optional() }),

  // Providers (S02.04): an Admin publishes or unpublishes a provider and sets its last-confirmed date.
  // The subject is the provider (type `provider`, its catalogue id); listing text is never in meta.
  // `last_confirmed` / `confirmed_on` are required on an ok record (REQUIRED_WHEN_OK), absent on a refusal.
  "provider.published": meta({ last_confirmed: isoDate.optional() }),
  "provider.unpublished": meta({}),
  "provider.confirmed": meta({ confirmed_on: isoDate.optional(), previous: isoDate.nullable().optional() }),

  // Alert threads and entries (S04.03). `alert.created` is on the thread (subject `alert`) and names its first
  // draft; the others are on the entry (subject `alert_entry`). `content_hash` is the frozen text's SHA-256, never
  // text. `entry_id` (and `version`, `content_hash` where the entry has them) are required on an ok record.
  "alert.created": meta({ entry_id: id.optional(), kind: entryKind.optional(), types: z.array(code).max(9).optional() }),
  "entry.submitted": meta({ entry_id: id.optional(), version: count.optional(), content_hash: sha256.optional() }),
  "entry.returned": meta({ entry_id: id.optional(), version: count.optional(), returned_for: z.enum(["edit", "return", "retranslate"]).optional() }),
  "entry.discarded": meta({ entry_id: id.optional(), version: count.optional(), from: z.enum(["draft", "pending_approval"]).optional() }),
  "entry.approved": meta({ entry_id: id.optional(), version: count.optional(), content_hash: sha256.optional() }),

  // Seed scripts (S01.13, S02.04, S02.09): which seed, and counts by kind.
  "seed.run": meta({ seed: code, counts: z.record(code, count).optional(), warnings: count.optional(), failures: count.optional() }),

  // First-text spike (S01.15): the provider's answer, never the number or the text. `twilio_sid` is the Twilio message SID
  // (the subject is always the ledger row's id). `outcome_unknown` marks "no answer": the text may or may not have gone.
  "sms.test_sent": meta({
    http_status: z.number().int().min(100).max(599).optional(),
    provider_status: code.optional(),
    provider_error_code: z.number().int().nonnegative().max(999_999).optional(),
    twilio_sid: z.string().regex(/^(SM|MM)[0-9a-f]{32}$/).optional(),
    outcome_unknown: z.literal(true).optional(),
  }),
  // Written in the claim's own transaction, before Twilio is called: a send is never invisible to the audit trail.
  "sms.test_attempted": meta({}),
} as const satisfies Record<string, z.ZodType>;

export type AuditAction = keyof typeof AUDIT_META;
export type AuditMeta<A extends AuditAction> = z.input<(typeof AUDIT_META)[A]>;
export type AuditOutcome = "ok" | "refused";

/**
 * Meta fields an `ok` record must carry although the schema leaves them optional (a `refused` record
 * carries only its reason). A provider's confirmation names the date it set; its publication the
 * last-confirmed date it published on.
 */
const REQUIRED_WHEN_OK: Partial<Record<AuditAction, readonly string[]>> = {
  "provider.confirmed": ["confirmed_on"],
  "provider.published": ["last_confirmed"],
  "alert.created": ["entry_id"],
  "entry.submitted": ["entry_id", "version", "content_hash"],
  "entry.returned": ["entry_id", "version", "returned_for"],
  "entry.discarded": ["entry_id", "from"],
  "entry.approved": ["entry_id", "version", "content_hash"],
};

export const AUDIT_ACTIONS = Object.keys(AUDIT_META) as AuditAction[];

/** `meta` is optional only when no field of the action's schema is required. */
type MetaField<A extends AuditAction> = Record<string, never> extends AuditMeta<A>
  ? { meta?: AuditMeta<A> }
  : { meta: AuditMeta<A> };

export type AuditEvent<A extends AuditAction = AuditAction> = {
  action: A;
  /** The staff member who acted; SYSTEM_ACTOR (null) for the system (scripts, jobs, unknown usernames). */
  actorStaffId: string | null;
  /** What the action was on, as a lower_snake_case type (`staff_account`, `building`). */
  subjectType: string;
  /** The subject's id; never a phone number, email address or username. */
  subjectId: string | null;
  isDrill?: boolean;
} & MetaField<A>;

/** A validated record, ready to insert. */
export interface AuditRecord {
  action: AuditAction;
  actorStaffId: string | null;
  subjectType: string;
  subjectId: string | null;
  outcome: AuditOutcome;
  isDrill: boolean;
  meta: Record<string, unknown>;
}

/** An audit event that may not be stored. Its message names fields, never their values. */
export class AuditRecordError extends Error {
  override name = "AuditRecordError";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether the text holds something like local@domain.tld. Written as a scan of
 * the whitespace-separated words rather than the regular expression
 * /[^\s@]+@[^\s@]+\.[^\s@]+/, which backtracks quadratically on a long word
 * without an "@" (50,000 letters take seconds).
 */
function hasEmailAddress(value: string): boolean {
  for (const word of value.split(/\s+/)) {
    if (word.length < 5) continue;
    const parts = word.split("@");
    for (let i = 1; i < parts.length; i += 1) {
      const domain = parts[i];
      const dot = domain.indexOf(".", 1);
      if (parts[i - 1] !== "" && dot !== -1 && dot < domain.length - 1) return true;
    }
  }
  return false;
}

// Ten or more digits, allowing the separators phone numbers are written with.
const PHONE = /(?:\d[\s().+\-/_:]{0,3}){10,}/;
// A Twilio message SID: SM or MM and 32 lowercase hex digits, which can hold long digit runs.
const TWILIO_SID = /^(SM|MM)[0-9a-f]{32}$/;
// A SHA-256 in hex (an entry's content hash): 64 hex digits, which can hold long digit runs.
const SHA256_HEX = /^[0-9a-f]{64}$/;
// The one place in an audit record's meta where a SHA-256 is expected, and so where the phone check is skipped.
const CONTENT_HASH_PATH = "meta.content_hash";

/**
 * Defensive check on values (the strict schemas are the main guard): the path
 * of the first string that looks like an email address or a phone number, or
 * of a number with ten or more digits. Whole values that are UUIDs or Twilio message SIDs are
 * skipped (their hex can hold long digit runs), and so is a SHA-256 at `meta.content_hash` only: in
 * any other field a 64-digit hex string is checked like any text, so a phone number cannot hide in
 * one.
 */
export function findSensitiveValue(value: unknown, path = "meta"): string | null {
  if (typeof value === "string") {
    if (UUID.test(value) || TWILIO_SID.test(value) || (path === CONTENT_HASH_PATH && SHA256_HEX.test(value))) return null;
    return hasEmailAddress(value) || PHONE.test(value) ? path : null;
  }
  if (typeof value === "number") return Math.abs(value) >= 1e9 ? path : null;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findSensitiveValue(item, `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const found = findSensitiveValue(item, `${path}.${key}`);
      if (found) return found;
    }
  }
  return null;
}

const SUBJECT_TYPE = /^[a-z][a-z0-9_]{0,39}$/;
/**
 * A subject id is a uuid, a small integer id, a lower_snake_case code (no
 * hyphens, dots or colons, a letter first), a catalogue id (one capital letter and
 * 3 to 6 digits, like the provider M001) or a Twilio message SID: nothing a
 * phone number, an email address, a username or a token can be written as.
 */
const SUBJECT_ID = /^(?:[0-9]{1,9}|[a-z][a-z0-9_]{0,39}|(?:SM|MM)[0-9a-f]{32})$/;
/**
 * Extra subject id forms allowed for one subject type only, so the wider form is not open to every
 * subject: a provider's catalogue id (one capital letter and 3 to 6 digits, like M001).
 */
const SUBJECT_ID_BY_TYPE: Readonly<Record<string, RegExp>> = {
  provider: /^[A-Z][0-9]{3,6}$/,
};

function isSubjectId(subjectType: string, subjectId: string): boolean {
  if (UUID.test(subjectId) || SUBJECT_ID.test(subjectId)) return true;
  return Object.hasOwn(SUBJECT_ID_BY_TYPE, subjectType) && SUBJECT_ID_BY_TYPE[subjectType].test(subjectId);
}

/**
 * A path segment safe to print: an array index, or a key of the action's own
 * schema. Anything else is a key of a record (`seed.run` counts) or came from
 * the caller, and may hold a phone number or an email address.
 */
function safeSegment(action: AuditAction, segment: PropertyKey, depth: number): string {
  if (typeof segment === "number") return String(segment);
  const known = depth === 0 && typeof segment === "string" && Object.hasOwn(AUDIT_META[action].shape, segment);
  return known ? String(segment) : "(key)";
}

function isAuditAction(action: unknown): action is AuditAction {
  return typeof action === "string" && Object.hasOwn(AUDIT_META, action);
}

/**
 * Validates an event and turns it into the record to store, or throws
 * AuditRecordError: an unknown action, a field outside the action's `meta`
 * schema, or a value that looks like personal data. Invalid events are bugs in
 * the caller, so they throw rather than return a result.
 */
export function toAuditRecord(event: AuditEvent, outcome: AuditOutcome): AuditRecord {
  const { action } = event;
  if (!isAuditAction(action)) throw new AuditRecordError("Unknown audit action");
  if (event.actorStaffId !== null && !UUID.test(event.actorStaffId)) {
    throw new AuditRecordError(`${action}: actorStaffId must be a staff account id (uuid) or null`);
  }
  if (!SUBJECT_TYPE.test(event.subjectType)) {
    throw new AuditRecordError(`${action}: subjectType must be a lower_snake_case type`);
  }
  if (event.subjectId !== null && (!isSubjectId(event.subjectType, event.subjectId) || findSensitiveValue(event.subjectId))) {
    throw new AuditRecordError(`${action}: subjectId must be an id, never personal data`);
  }

  const parsed = AUDIT_META[action].safeParse(event.meta ?? {});
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const where = ["meta", ...issue.path.map((segment, depth) => safeSegment(action, segment, depth))].join(".");
      if (issue.code !== "unrecognized_keys") return `${where} is invalid`;
      // Name the extra fields only when the name itself cannot carry data.
      const keys = issue.keys.map((key) => (/^[A-Za-z_]{1,40}$/.test(key) ? key : "(unnamed)"));
      return `${where} has fields outside the schema: ${keys.join(", ")}`;
    });
    throw new AuditRecordError(`${action}: ${problems.join("; ")}`);
  }
  if (outcome === "ok") {
    const data = parsed.data as Record<string, unknown>;
    const missing = (REQUIRED_WHEN_OK[action] ?? []).filter((field) => data[field] === undefined);
    if (missing.length > 0) throw new AuditRecordError(`${action}: meta is missing ${missing.join(", ")}`);
  }
  const sensitive = findSensitiveValue(parsed.data);
  if (sensitive) throw new AuditRecordError(`${action}: ${sensitive} looks like a phone number or email address`);

  return {
    action,
    actorStaffId: event.actorStaffId,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    outcome,
    isDrill: event.isDrill ?? false,
    meta: parsed.data,
  };
}
