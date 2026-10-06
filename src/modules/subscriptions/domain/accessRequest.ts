// A resident's access request (S09.03, E09 "Access request", PIPEDA): the rules that need no database. A request is kept only as two audit records, `received`
// and `closed`, with the request as the subject (no table, no number); this file pairs them into the requests still open, says which are past 25 days of the
// 30-day limit, and writes what the CVH holds for a number as the lines IT reads out on screen. Nothing here is saved anywhere.

/** What a resident may ask for (audit's ACCESS_REQUEST_KINDS). */
export type AccessRequestKind = "access" | "correction" | "deletion";
/** How a request ends (audit's ACCESS_REQUEST_OUTCOMES). `deleted` is the deletion's own, never given by hand. */
export type AccessRequestOutcome = "answered" | "deleted" | "not_verified" | "withdrawn";
export type ClosingOutcome = Exclude<AccessRequestOutcome, "deleted">;
export const CLOSING_OUTCOMES: readonly ClosingOutcome[] = ["answered", "not_verified", "withdrawn"];

/** PIPEDA: an access request is answered within 30 days. */
export const ACCESS_REQUEST_LIMIT_DAYS = 30;
/** The weekly review (S09.04's `weekly_review`) and the list flag a request open longer than this. */
export const ACCESS_REQUEST_FLAG_DAYS = 25;

const DAY_MS = 86_400_000;

/** One audit record of a request, as the trail holds it. */
export interface RequestRecord {
  action: "access_request.received" | "access_request.closed";
  at: Date;
  subjectId: string;
  actorStaffId: string | null;
  isDrill: boolean;
  meta: Record<string, unknown>;
}

/** A request still open: received and not closed. */
export interface OpenRequest {
  id: string;
  request: AccessRequestKind | null;
  receivedAt: Date;
  receivedBy: string | null;
  /** A rehearsal's request (S09.03 rehearsals): reported apart in the weekly review. */
  rehearsal: boolean;
  /** Whole days since it was received. */
  daysOpen: number;
  /** Open longer than 25 days: the weekly review flags it, and the 30-day limit is near or gone. */
  flagged: boolean;
  /** The last day to answer: 30 days after it was received. */
  dueBy: Date;
}

/** Where a request stands, from its own records: unknown (never received), open, or closed. */
export type RequestStanding = { kind: "unknown" } | { kind: "open"; receivedAt: Date; isDrill: boolean } | { kind: "closed"; outcome: string | null; closedAt: Date };

export function standingOf(records: readonly RequestRecord[], id: string): RequestStanding {
  const own = records.filter((record) => record.subjectId === id);
  const received = own.find((record) => record.action === "access_request.received");
  if (!received) return { kind: "unknown" };
  const closed = own.find((record) => record.action === "access_request.closed");
  if (closed) return { kind: "closed", outcome: typeof closed.meta.outcome === "string" ? closed.meta.outcome : null, closedAt: closed.at };
  return { kind: "open", receivedAt: received.at, isDrill: received.isDrill };
}

const KINDS: readonly string[] = ["access", "correction", "deletion"];

/** The requests still open, the oldest first. */
export function openRequests(records: readonly RequestRecord[], now: Date): OpenRequest[] {
  const closed = new Set(records.filter((record) => record.action === "access_request.closed").map((record) => record.subjectId));
  return records
    .filter((record) => record.action === "access_request.received" && !closed.has(record.subjectId))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((record) => {
      const openMs = now.getTime() - record.at.getTime();
      const request = typeof record.meta.request === "string" && KINDS.includes(record.meta.request) ? (record.meta.request as AccessRequestKind) : null;
      return {
        id: record.subjectId,
        request,
        receivedAt: record.at,
        receivedBy: record.actorStaffId,
        rehearsal: record.isDrill,
        daysOpen: Math.max(0, Math.floor(openMs / DAY_MS)),
        flagged: openMs > ACCESS_REQUEST_FLAG_DAYS * DAY_MS,
        dueBy: new Date(record.at.getTime() + ACCESS_REQUEST_LIMIT_DAYS * DAY_MS),
      };
    });
}

/** Whole days from one instant to another (a closed request's time open). */
export function wholeDays(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

/** A place as it is read out: the building's address (or its register number when the building is gone) and the floor's label, or none. */
export interface HeldPlace {
  rsn: string;
  address: string | null;
  floor: string | null;
}

/** One text the CVH holds a record of (messaging's RecipientText): never its words. */
export interface HeldText {
  createdAt: Date;
  kind: string;
  purpose: string | null;
  lang: string;
  state: string;
  segments: number;
  resendN: number | null;
  providerErrorCode: number | null;
}

/** Check-in records (E08): not built yet, built and read, or a table this script cannot read yet (then nothing may be answered as complete). */
export type HeldCheckins = { kind: "not_built" } | { kind: "unreadable" } | { kind: "rows"; rows: readonly { at: Date; description: string }[] };

/** Everything the CVH holds for one number, as a resident's access request reads it back. */
export interface HeldRecord {
  /** The number masked to its last four digits: the screen confirms which number was looked up without showing it whole. */
  maskedNumber: string;
  subscriber: {
    since: Date;
    lang: string;
    neighbourhood: string;
    groups: readonly string[];
    consentVersion: string;
    startedBy: string;
    retentionState: string;
    places: readonly HeldPlace[];
    mutedTopics: readonly string[];
    prompt: { kind: string; until: Date } | null;
    /** The link texted to change or delete the subscription on the web (S07.06), or none; its token is never held, and its hash is never shown. */
    editLink: { since: Date; expiresAt: Date; expired: boolean; usedAt: Date | null } | null;
  } | null;
  pending: {
    since: Date;
    expiresAt: Date;
    expired: boolean;
    lang: string;
    neighbourhood: string;
    groups: readonly string[];
    topics: readonly string[];
    consentVersion: string;
    startedBy: string;
    places: readonly HeldPlace[];
  } | null;
  /** `inbound_reply` rows: a number with no subscription waiting for its one reply (30 minutes at most). */
  replies: readonly { since: Date; expiresAt: Date }[];
  texts: readonly HeldText[];
  /** Keyed hashes of the number in `rate_limit`, by scope (deleted after 24 hours). */
  hashes: readonly { scope: string; count: number; latest: Date }[];
  checkins: HeldCheckins;
  /**
   * What holds this number's records and the lookup cannot read yet: a column or a table added after it was written (E08's check-in request, for example).
   * Empty until a story adds one; while it is not, the request is never answered as complete.
   */
  unread: readonly string[];
}

/** Whether nothing at all is held for the number (a check-in table that cannot be read is never "nothing"). */
export function nothingHeld(record: HeldRecord): boolean {
  return (
    record.subscriber === null &&
    record.pending === null &&
    record.replies.length === 0 &&
    record.texts.length === 0 &&
    record.hashes.length === 0 &&
    record.unread.length === 0 &&
    (record.checkins.kind === "not_built" || (record.checkins.kind === "rows" && record.checkins.rows.length === 0))
  );
}

const TORONTO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** An instant as Toronto reads it: `2026-10-06 09:30`. */
export function torontoTime(at: Date): string {
  const part = (type: string) => TORONTO.formatToParts(at).find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

const list = (items: readonly string[]) => (items.length === 0 ? "none" : items.join(", "));
const place = (p: HeldPlace) => `${p.address ?? "a building no longer in the register"} (register number ${p.rsn}), ${p.floor === null ? "no floor" : `floor ${p.floor}`}`;

function editLinkLine(link: NonNullable<NonNullable<HeldRecord["subscriber"]>["editLink"]>): string {
  const used = link.usedAt === null ? "not used" : `used ${torontoTime(link.usedAt)}`;
  const expired = link.expired ? "; expired: the purge deletes it within 15 minutes" : "";
  return `asked for ${torontoTime(link.since)}, valid until ${torontoTime(link.expiresAt)}, ${used}${expired}`;
}

function textLine(text: HeldText): string {
  const what = text.kind === "alert" ? "alert" : `${text.kind} text (${text.purpose ?? "no purpose"})`;
  const resend = text.resendN === null ? "" : `, resend ${text.resendN}`;
  const error = text.providerErrorCode === null ? "" : `, provider error ${text.providerErrorCode}`;
  return `  ${torontoTime(text.createdAt)}  ${what} in ${text.lang}, ${text.segments} segment${text.segments === 1 ? "" : "s"}, ${text.state}${resend}${error}`;
}

/**
 * What the CVH holds for the number, as the lines IT reads out on screen (English, Toronto time). Message words are never among them: a text is listed by
 * its date, kind, language and outcome.
 */
export function heldRecordLines(record: HeldRecord): string[] {
  const lines = [`What the CVH holds for ${record.maskedNumber}:`, ""];
  if (record.subscriber) {
    const s = record.subscriber;
    lines.push(
      "Subscriber (gets text alerts):",
      `  Signed up: ${torontoTime(s.since)}, ${s.startedBy === "staff" ? "with a staff member's help" : "on the web"}`,
      `  Language: ${s.lang}`,
      `  Neighbourhood: ${s.neighbourhood}`,
      `  Groups: ${list(s.groups)}`,
      s.places.length === 0 ? "  Places: none" : "  Places:",
      ...s.places.map((p) => `    ${place(p)}`),
      `  Muted topics: ${list(s.mutedTopics)}`,
      `  Terms accepted (consent version): ${s.consentVersion}`,
      `  Retention state: ${s.retentionState}`,
      `  Open prompt: ${s.prompt === null ? "none" : `${s.prompt.kind}, until ${torontoTime(s.prompt.until)}`}`,
      `  Edit link (texted to change or delete the subscription on the web): ${s.editLink === null ? "none" : editLinkLine(s.editLink)}`,
    );
  } else {
    lines.push("Subscriber: none");
  }
  if (record.pending) {
    const p = record.pending;
    lines.push(
      `Pending sign-up (waiting for YES${p.expired ? ", expired: the purge deletes it within 15 minutes" : ""}):`,
      `  Started: ${torontoTime(p.since)}, ${p.startedBy === "staff" ? "with a staff member's help" : "on the web"}; YES accepted until ${torontoTime(p.expiresAt)}`,
      `  Language: ${p.lang}`,
      `  Neighbourhood: ${p.neighbourhood}`,
      `  Groups: ${list(p.groups)}`,
      p.places.length === 0 ? "  Places: none" : "  Places:",
      ...p.places.map((pl) => `    ${place(pl)}`),
      `  Muted topics: ${list(p.topics)}`,
      `  Terms accepted (consent version): ${p.consentVersion}`,
    );
  } else {
    lines.push("Pending sign-up: none");
  }
  lines.push(
    record.replies.length === 0
      ? "Waiting reply to a number with no subscription: none"
      : `Waiting reply to a number with no subscription: ${record.replies.length} (each deleted when its reply goes, or after 30 minutes)`,
  );
  lines.push(record.texts.length === 0 ? "Texts: none" : `Texts (${record.texts.length}; the words are not kept here and are not read out):`);
  lines.push(...record.texts.map(textLine));
  lines.push(
    record.hashes.length === 0
      ? "Keyed hashes of the number (rate limits): none"
      : `Keyed hashes of the number (rate limits, each deleted after 24 hours): ${record.hashes.map((h) => `${h.scope} ${h.count}, latest ${torontoTime(h.latest)}`).join("; ")}`,
  );
  switch (record.checkins.kind) {
    case "not_built":
      lines.push("Check-in records: none (check-ins are not built yet)");
      break;
    case "unreadable":
      lines.push("Check-in records: A CHECK-IN TABLE EXISTS THAT THIS SCRIPT CANNOT READ YET. Do not answer the request as complete: ask IT to add check-ins to scripts/access-request.");
      break;
    case "rows":
      lines.push(record.checkins.rows.length === 0 ? "Check-in records: none" : `Check-in records (${record.checkins.rows.length}):`);
      lines.push(...record.checkins.rows.map((row) => `  ${torontoTime(row.at)}  ${row.description}`));
      break;
  }
  if (record.unread.length > 0) {
    lines.push(
      `NOT SHOWN: THE CVH HOLDS MORE FOR THIS NUMBER THAN THIS SCRIPT CAN READ YET (${record.unread.join("; ")}). Do not answer the request as complete: ask IT to add it to scripts/access-request.`,
    );
  }
  if (nothingHeld(record)) lines.push("", "Nothing is held for this number.");
  return lines;
}

/**
 * What a deletion on the resident's behalf would remove, in one line IT checks before typing DELETE: the masked number (its last four digits) and what is held
 * for it, so a mistyped number is noticed before anything is deleted.
 */
export function deletionSummary(record: HeldRecord): string {
  const subscriber = record.subscriber ? `a subscriber since ${torontoTime(record.subscriber.since)}` : "no subscriber";
  const pending = record.pending ? `a pending sign-up since ${torontoTime(record.pending.since)}` : "no pending sign-up";
  const replies = `${record.replies.length} waiting repl${record.replies.length === 1 ? "y" : "ies"}`;
  const texts = `${record.texts.length} text${record.texts.length === 1 ? "" : "s"} on record`;
  return `For ${record.maskedNumber} the CVH holds ${subscriber}, ${pending}, ${replies} and ${texts}.`;
}
