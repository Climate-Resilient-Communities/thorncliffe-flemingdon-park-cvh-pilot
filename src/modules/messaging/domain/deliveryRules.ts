/**
 * What a `delivery` row is, and the rules for creating one (AD-8, E06 definitions). The `delivery_insert_guard`
 * trigger (db/migrations/20261003100000_delivery_outbox.sql) and `delivery_purpose_rule()` mirror these rules and
 * refuse anything else, whoever asks; test/db/delivery.db.test.ts checks the two against each other for every module
 * and purpose.
 *
 * Pure: no I/O and no clock. The queue's use cases (../application/deliveryQueue.ts) ask here before they write, so a
 * caller gets an expected refusal; the trigger is the defence in depth.
 */
import { LANG_CODES, type LangCode } from "../../../contracts/lang";
import { looksLikePhoneNumber } from "./phoneNumber";

export const DELIVERY_KINDS = ["alert", "transactional", "campaign"] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

/** Whom a text goes to, and so which table `recipient_id` belongs to (see RECIPIENT_OWNER). */
export const RECIPIENT_KINDS = ["subscriber", "pending_signup", "roster", "staff", "oncall", "inbound_reply"] as const;
export type RecipientKind = (typeof RECIPIENT_KINDS)[number];

/** The modules that create deliveries (AD-8). Nothing else does. */
export const CREATING_MODULES = ["alerting", "subscriptions", "checkins", "ops"] as const;
export type CreatingModule = (typeof CREATING_MODULES)[number];

/** The only channel in the pilot (the channel is part of an alert's idempotency key). */
export const CHANNELS = ["sms"] as const;
export type Channel = (typeof CHANNELS)[number];

/** An alert goes to a subscriber, or, for a drill, to a member of the drill roster (S06.05 adds the drill rule). */
export const ALERT_RECIPIENT_KINDS = ["subscriber", "roster"] as const satisfies readonly RecipientKind[];

/** Twilio refuses a body of more than 1600 characters. */
export const BODY_MAX_CHARS = 1600;
/** 1600 characters in UCS-2 (67 per segment of a long message) is 24 segments. */
export const SEGMENTS_MAX = 24;

/**
 * The module whose table holds each kind of recipient, and so the module the ContactResolver asks for the number
 * (AD-2: wired in the composition root, src/app/messaging.ts). `drill_roster`, `subscriber`, `pending_signup` and
 * `inbound_reply` are subscriptions' tables; `staff` is identity's; `oncall` is ops' (`oncall_roster`).
 */
export const RECIPIENT_OWNER = {
  subscriber: "subscriptions",
  pending_signup: "subscriptions",
  roster: "subscriptions",
  inbound_reply: "subscriptions",
  staff: "identity",
  oncall: "ops",
} as const satisfies Record<RecipientKind, "subscriptions" | "identity" | "ops">;

/** The kinds whose number is taken at the hand-off point: the row is deleted in the hand-off transaction (E06 definitions). */
export const NUMBER_CONSUMED_AT_HAND_OFF = ["inbound_reply"] as const satisfies readonly RecipientKind[];

export function isConsumedAtHandOff(kind: RecipientKind): boolean {
  return (NUMBER_CONSUMED_AT_HAND_OFF as readonly string[]).includes(kind);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * One purpose of a `transactional` text: the module that may create it, the kinds of recipient it may go to, and how far
 * ahead its `send_by` may be ("Each purpose sets a send_by", E06 definitions). `windowMs` is the longest `send_by`
 * from now; a text still queued after its `send_by` is skipped at the hand-off point, not sent late.
 */
export interface TransactionalPurpose {
  module: CreatingModule;
  purpose: string;
  recipientKinds: readonly RecipientKind[];
  windowMs: number;
  /** True where the recipient's own row sets `send_by` (`signup_info`: the `inbound_reply` row's `expires_at`), so the caller gives it. */
  sendByIsRecipientExpiry?: true;
}

/**
 * The allow-list (E06 "Sendable (transactional)"): `alerting` approver notices; `subscriptions` confirmations (to
 * `pending_signup` recipients only), welcome texts, menu and prompt replies, edit links, and `signup_info` to
 * `inbound_reply` recipients only; `checkins` escalations; `ops` on-call alerts. The windows are 30 minutes for a menu
 * reply, 48 hours for a confirmation and 30 minutes for `signup_info` (its `inbound_reply` row's `expires_at`), as the
 * definitions say; the others are proposals for the owner to confirm (docs/planning/pilot/epics.md, S06.01).
 */
export const TRANSACTIONAL_PURPOSES: readonly TransactionalPurpose[] = [
  { module: "alerting", purpose: "approver_notice", recipientKinds: ["staff"], windowMs: 30 * MINUTE_MS },
  { module: "subscriptions", purpose: "confirmation", recipientKinds: ["pending_signup"], windowMs: 48 * HOUR_MS },
  { module: "subscriptions", purpose: "welcome", recipientKinds: ["subscriber"], windowMs: 24 * HOUR_MS },
  { module: "subscriptions", purpose: "menu_reply", recipientKinds: ["subscriber"], windowMs: 30 * MINUTE_MS },
  { module: "subscriptions", purpose: "prompt_reply", recipientKinds: ["subscriber"], windowMs: 30 * MINUTE_MS },
  { module: "subscriptions", purpose: "edit_link", recipientKinds: ["subscriber"], windowMs: 30 * MINUTE_MS },
  { module: "subscriptions", purpose: "signup_info", recipientKinds: ["inbound_reply"], windowMs: 30 * MINUTE_MS, sendByIsRecipientExpiry: true },
  { module: "checkins", purpose: "escalation", recipientKinds: ["oncall"], windowMs: 60 * MINUTE_MS },
  { module: "ops", purpose: "oncall_alert", recipientKinds: ["oncall"], windowMs: 30 * MINUTE_MS },
];

/** The purpose's rule when the module may create it; undefined when it is not on that module's allow-list. */
export function purposeRule(module: string, purpose: string): TransactionalPurpose | undefined {
  return TRANSACTIONAL_PURPOSES.find((rule) => rule.module === module && rule.purpose === purpose);
}

/** Why a delivery is refused before it is written (the trigger refuses the same things, as errors). */
export type DeliveryRefusal =
  | "PURPOSE_NOT_ALLOWED"
  | "RECIPIENT_NOT_ALLOWED"
  | "SEND_BY_INVALID"
  | "KEY_PART_INVALID"
  | "BODY_INVALID"
  | "SEGMENTS_INVALID"
  | "COST_INVALID"
  | "LANG_INVALID"
  | "ID_INVALID"
  | "CAMPAIGN_PURPOSE_INVALID";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A part of a key that is not an id: letters, digits, dots, underscores and dashes, so never a colon or a plus sign. */
const KEY_PART = /^[A-Za-z0-9._-]{1,64}$/;
const PURPOSE_CODE = /^[a-z][a-z0-9_]{0,39}$/;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export function isLangCode(value: unknown): value is LangCode {
  return typeof value === "string" && (LANG_CODES as readonly string[]).includes(value);
}

/**
 * The key of an alert delivery: `entry_id:recipient:channel`, so one recipient is texted once per entry and channel.
 * The recipient is the id of the person's row in the table of its kind, never a number.
 */
export function alertKey(entryId: string, recipientId: string, channel: Channel = "sms"): string {
  return `${entryId}:${recipientId}:${channel}`;
}

/**
 * The key of a transactional or campaign delivery: `kind:subject:purpose:nonce`. The subject is what the text is about
 * and the nonce tells two texts about it apart (a request id, a message id); neither may be a phone number.
 * Returns null when a part would not pass the table's check.
 */
export function outboundKey(parts: { kind: "transactional" | "campaign"; subject: string; purpose: string; nonce: string }): string | null {
  const { kind, subject, purpose, nonce } = parts;
  if (![subject, nonce].every((part) => KEY_PART.test(part) && !looksLikePhoneNumber(part))) return null;
  if (!PURPOSE_CODE.test(purpose)) return null;
  return `${kind}:${subject}:${purpose}:${nonce}`;
}

/** What every delivery freezes: its language, its body, its segments and its cost estimate (integer cents CAD). */
export interface DeliveryContent {
  lang: string;
  body: string;
  segments: number;
  costEstimateCents: number;
}

/** The refusal for content the table would not hold: an unknown language, an empty or over-long body, bad counts. */
export function contentRefusal(content: DeliveryContent): DeliveryRefusal | null {
  if (!isLangCode(content.lang)) return "LANG_INVALID";
  if (content.body.trim() === "" || [...content.body].length > BODY_MAX_CHARS) return "BODY_INVALID";
  if (!Number.isInteger(content.segments) || content.segments < 1 || content.segments > SEGMENTS_MAX) return "SEGMENTS_INVALID";
  if (!Number.isInteger(content.costEstimateCents) || content.costEstimateCents < 0) return "COST_INVALID";
  return null;
}

/** The refusal for an alert delivery's recipient: a subscriber, or a drill-roster member. */
export function alertRecipientRefusal(recipient: { kind: string; id: string }): DeliveryRefusal | null {
  if (!isUuid(recipient.id)) return "ID_INVALID";
  return (ALERT_RECIPIENT_KINDS as readonly string[]).includes(recipient.kind) ? null : "RECIPIENT_NOT_ALLOWED";
}

/**
 * The refusal for a transactional delivery's purpose, recipient and `send_by`. `sendBy` is given only where the
 * recipient's own row sets the limit (`signup_info`: its `inbound_reply` row's `expires_at`); otherwise the queue gives
 * the purpose's window from the database's clock. A given `send_by` must be ahead of now and within the window.
 */
export function transactionalRefusal(input: { module: string; purpose: string; recipient: { kind: string; id: string }; sendBy?: Date | null; now: Date }): DeliveryRefusal | null {
  const rule = purposeRule(input.module, input.purpose);
  if (!rule) return "PURPOSE_NOT_ALLOWED";
  if (!isUuid(input.recipient.id)) return "ID_INVALID";
  if (!(rule.recipientKinds as readonly string[]).includes(input.recipient.kind)) return "RECIPIENT_NOT_ALLOWED";
  if (rule.sendByIsRecipientExpiry && (input.sendBy === undefined || input.sendBy === null)) return "SEND_BY_INVALID";
  if (input.sendBy !== undefined && input.sendBy !== null) {
    const ahead = input.sendBy.getTime() - input.now.getTime();
    if (Number.isNaN(ahead) || ahead <= 0 || ahead > rule.windowMs) return "SEND_BY_INVALID";
  }
  return null;
}

/** The refusal for a campaign delivery's purpose (a code, as for `spend_event`); the start by an Admin at aal2 is the trigger's. */
export function campaignRefusal(input: { purpose: string; recipient: { kind: string; id: string }; campaignId: string }): DeliveryRefusal | null {
  if (!PURPOSE_CODE.test(input.purpose)) return "CAMPAIGN_PURPOSE_INVALID";
  if (!isUuid(input.recipient.id) || !isUuid(input.campaignId)) return "ID_INVALID";
  return (RECIPIENT_KINDS as readonly string[]).includes(input.recipient.kind) ? null : "RECIPIENT_NOT_ALLOWED";
}
