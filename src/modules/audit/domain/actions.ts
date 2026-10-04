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
  /** A directory publish gave up after its attempts (S02.05); the previous release stays current. */
  "publish_failed",
  /** A directory publish is already running (S02.05). */
  "publish_running",
  /** S01.15 (the removed first-text spike): kept so that audit records already written with this reason stay readable. */
  "not_available",
  /** A change to a thread that is closed (S04.03, ALERT_CLOSED). */
  "alert_closed",
  /** S06.06: refused because all texts are paused (the first-text spike, removed by S06.09, wrote it as well). */
  "paused",
] as const;

/** Why an assignment was removed when it was not an Admin's choice: the refusal reasons, and the account leaving the Ambassador role. */
const REMOVAL_REASONS = [...REFUSAL_REASONS, "role_changed"] as const;

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
/** The code of a lifecycle refusal (`ENTRY_CHANGED`, `VALID_UNTIL_PAST`, ...): a code, never text (S04.07). */
const refusalCode = z.string().regex(/^[A-Z][A-Z0-9_]{2,40}$/);
/** An alert entry's kind (AD-5). */
const entryKind = z.enum(["ack", "update", "correction", "withdrawal", "final"]);
/** The floors of an assignment by id; null is every floor of the building. */
const floorIds = z.array(id).max(200).nullable();
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
  // S02.08: an Admin entered, changed or removed the building contact. The role and number are never in meta.
  "building.contact_changed": meta({ cleared: flag.optional() }),

  // Ambassador assignments (S01.14). `floor_ids: null` is the whole building. `previous_floor_ids` is what a replaced
  // assignment listed (absent on a first assignment). `assignment.removed` records the floors the assignment listed,
  // and its reason may also be `role_changed`: the account left the Ambassador role and its assignments went with it.
  "assignment.saved": meta({
    staff_id: id.optional(),
    rsn: rsn.optional(),
    floor_ids: floorIds.optional(),
    previous_floor_ids: floorIds.optional(),
  }),
  // Not built with meta(): its `reason` is the common list plus `role_changed`, which a spread of `common` would intersect away.
  "assignment.removed": z.strictObject({
    reason: z.enum(REMOVAL_REASONS).optional(),
    staff_id: id.optional(),
    rsn: rsn.optional(),
    floor_ids: floorIds.optional(),
  }),

  // Providers (S02.04): an Admin publishes or unpublishes a provider and sets its last-confirmed date.
  // The subject is the provider (type `provider`, its catalogue id); listing text is never in meta.
  // `last_confirmed` / `confirmed_on` are required on an ok record (REQUIRED_WHEN_OK), absent on a refusal.
  "provider.published": meta({ last_confirmed: isoDate.optional() }),
  "provider.unpublished": meta({}),
  "provider.confirmed": meta({ confirmed_on: isoDate.optional(), previous: isoDate.nullable().optional() }),

  // Alert threads and entries (S04.03). `alert.created` is on the thread (subject `alert`) and names its first
  // draft; the others are on the entry (subject `alert_entry`). `content_hash` is the frozen text's SHA-256, never
  // text. `entry_id` (and `version`, `content_hash` where the entry has them) are required on an ok record.
  // S04.07: a refusal also names its code (`refusal`: ENTRY_CHANGED, VALID_UNTIL_PAST, RECIPIENT_COUNT_CHANGED, ...), so the record
  // says which rule refused and not only the group of reasons it belongs to; an approval records `recipient_count`, the number of
  // people its recipient snapshot captured (AD-7, AR-11); a return records that it carried a note (the note itself is free text:
  // it stays on the entry and never goes into the audit trail).
  "alert.created": meta({ entry_id: id.optional(), kind: entryKind.optional(), types: z.array(code).max(9).optional(), refusal: refusalCode.optional() }),
  // S05.01: an update added to a running thread (`[*] -> draft` of a follow-up entry: its kind and the thread's types, no text).
  "entry.created": meta({ entry_id: id.optional(), kind: entryKind.optional(), types: z.array(code).max(9).optional(), refusal: refusalCode.optional() }),
  "entry.submitted": meta({ entry_id: id.optional(), version: count.optional(), content_hash: sha256.optional(), refusal: refusalCode.optional() }),
  "entry.returned": meta({
    entry_id: id.optional(),
    version: count.optional(),
    returned_for: z.enum(["edit", "return", "retranslate"]).optional(),
    with_note: z.literal(true).optional(),
    refusal: refusalCode.optional(),
  }),
  // `by_close`: the discard was made by the thread's close (S05.02: every draft and pending entry is discarded when a thread closes).
  "entry.discarded": meta({
    entry_id: id.optional(),
    version: count.optional(),
    from: z.enum(["draft", "pending_approval"]).optional(),
    by_close: z.literal(true).optional(),
    // S08.02: why it was discarded: its author took it back (`by_author`), the Hub did not send it (`declined`), or its thread closed first (`by_close`).
    discard_reason: z.enum(["by_author", "declined", "by_close"]).optional(),
    refusal: refusalCode.optional(),
  }),
  "entry.approved": meta({ entry_id: id.optional(), version: count.optional(), content_hash: sha256.optional(), recipient_count: count.optional(), reviewed_count: count.optional(), refusal: refusalCode.optional() }),
  // S05.02: the approval of a correction or a withdrawal replaced the entry it names (subject: the replaced entry; `by` is the correction or withdrawal,
  // `withdrawal_reason` the code a withdrawal gave). Written in the approval's own transaction, beside `entry.approved`.
  "entry.superseded": meta({
    entry_id: id.optional(),
    by: id.optional(),
    by_kind: z.enum(["correction", "withdrawal"]).optional(),
    withdrawal_reason: z.enum(["wrong_place", "wrong_information", "duplicate", "other"]).optional(),
    refusal: refusalCode.optional(),
  }),
  // S05.02: the one close path (`closeAlert`): how the thread closed, how many drafts and pending entries it discarded, and the entry whose texts were kept.
  "alert.closed": meta({
    closed_as: z.enum(["resolved", "expired", "withdrawn"]).optional(),
    discarded: count.optional(),
    kept_entry_id: id.optional(),
    refusal: refusalCode.optional(),
  }),
  // The directory release (S02.05): an Admin publishes the directory as one numbered release. The subject is the
  // release (type `directory_release`, its number); `meta` holds counts only. The release number and the counts are
  // required on an ok record (REQUIRED_WHEN_OK), absent on a refusal, which carries its reason.
  "directory.published": meta({
    release: count.optional(),
    providers: count.optional(),
    categories: count.optional(),
    files: count.optional(),
    /** Texts published in a language other than English. */
    translations: count.optional(),
    /** Of those, unreviewed machine translations of descriptions, shown labelled (AD-11 pilot change). */
    machine: count.optional(),
    /** Descriptions kept in English because they name a crisis or emergency line and no person reviewed the translation. */
    safety_critical: count.optional(),
    /** Texts published as English with translation.unavailable. */
    fallbacks: count.optional(),
    /** Translations withheld because the English changed since they were made. */
    stale: count.optional(),
    attempts: count.optional(),
    /** Files already stored when a stopped publish resumed. */
    resumed_files: count.optional(),
    /** On a refusal with reason `publish_failed`: why the publish failed (a PublishFailureCode). */
    failure: code.optional(),
  }),

  // Seed scripts (S01.13, S02.04, S02.09): which seed, and counts by kind.
  "seed.run": meta({ seed: code, counts: z.record(code, count).optional(), warnings: count.optional(), failures: count.optional() }),

  // The pause (S06.06): an Admin at aal2 pauses or resumes all texts. The subject is the one pause switch (type `messaging_control`,
  // id 1). `meta` holds counts only: the reason the Admin typed is free text, which an audit record never holds, so it lives on the
  // switch itself while the pause lasts. `waiting` is the texts the pause holds (or that resume lets go), `handed_off` the texts
  // already handed to the provider among those of the alerts and campaigns it holds. All are required on an ok record.
  "sending.paused": meta({ waiting: count.optional(), handed_off: count.optional() }),
  "sending.resumed": meta({ waiting: count.optional() }),

  // The on-call roster (S06.07): an Admin at aal2 adds or removes a number. The subject is the roster row (type `oncall_roster`, its id); the
  // number and the label are personal data and are in no audit record, which holds only how many numbers the roster has afterwards. A
  // refusal holds only its reason (`validation`: not a Canadian number or no label; `duplicate`: the number is already on the roster;
  // `conflict`: the roster is full; `not_found`: the entry was already removed).
  "oncall.added": meta({ roster_size: count.optional() }),
  "oncall.removed": meta({ roster_size: count.optional() }),

  // The drill roster (S06.05): an Admin at aal2 adds, edits or removes a roster entry. The subject is the roster row (type `drill_roster`, its id); the
  // number, the label and the language are in no audit record, which holds only how many entries the roster has afterwards. A refusal holds only its
  // reason (`validation`: no label, a label that is too long, not a Canadian number or not a language; `duplicate`: the number is already on the roster;
  // `conflict`: the roster is full; `not_found`: the entry was already removed).
  "drill_roster.added": meta({ roster_size: count.optional() }),
  "drill_roster.edited": meta({ roster_size: count.optional() }),
  "drill_roster.removed": meta({ roster_size: count.optional() }),
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
  "entry.created": ["entry_id", "kind"],
  "entry.submitted": ["entry_id", "version", "content_hash"],
  "entry.returned": ["entry_id", "version", "returned_for"],
  "entry.discarded": ["entry_id", "from"],
  "entry.approved": ["entry_id", "version", "content_hash", "recipient_count"],
  "entry.superseded": ["entry_id", "by", "by_kind"],
  "alert.closed": ["closed_as", "discarded"],
  "directory.published": ["release", "providers", "categories", "files", "translations", "fallbacks", "stale"],
  "sending.paused": ["waiting", "handed_off"],
  "sending.resumed": ["waiting"],
  "oncall.added": ["roster_size"],
  "oncall.removed": ["roster_size"],
  "drill_roster.added": ["roster_size"],
  "drill_roster.edited": ["roster_size"],
  "drill_roster.removed": ["roster_size"],
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
