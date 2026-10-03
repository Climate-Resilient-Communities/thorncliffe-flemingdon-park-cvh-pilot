import type { AssuranceLevel } from "../../../contracts/staffAuth";
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import type { AuditEvent } from "../../audit";
import type { StaffStanding } from "../../identity";
import type { SmsAttribution } from "../../messaging";
import type { EntryContent } from "../domain/content";
import type { EntryKind } from "../domain/lifecycle";
import type { FrozenTranslation } from "../domain/translations";
import type { AlertRefusal } from "../domain/refusals";

/** An expected outcome as a value (spine: Errors). */
export type AlertResult<T> = { ok: true; value: T } | { ok: false; error: AlertRefusal };

/**
 * Who acts: the staff member and the assurance level of their session, both read by the staff
 * guard from the verified session. The role, the status and the assignments are NOT taken from
 * here: each use case reads the person's standing from the database under its lock (AD-4).
 */
export interface AlertActor {
  staffId: string;
  aal: AssuranceLevel;
}

/**
 * Port: the audit trail. The composition root (this module's index.ts) wires the audit module's
 * `record` and `recordRefusal`; tests give fakes.
 */
export interface AlertAudit {
  /** Writes the `ok` record inside the change's own transaction, so both commit or neither does. */
  record(tx: DbTransaction, event: AuditEvent): Promise<void>;
  /** Writes the `refused` record in its own transaction, after the refused change was rolled back. Never throws. */
  recordRefusal(db: Db, event: AuditEvent): Promise<void>;
}

/** Port: a staff member's current role, status and assignments (identity's `readStaffStanding`), read through the executor given. */
export interface StaffDirectory {
  standing(executor: DbExecutor, staffId: string): Promise<StaffStanding | null>;
}

/** One language's SMS body, rendered once (S04.06) and counted. */
export interface FrozenSmsBody {
  body: string;
  encoding: "gsm7" | "ucs2";
  segments: number;
}

/**
 * What a submit freezes (S04.02 translates, S04.06 renders and hashes; both run outside any lock):
 * the web texts, the SMS bodies per language (`en` included) and the content hash that an approval
 * binds to.
 */
export interface FrozenContent {
  /** sha256 of the canonical JSON (alerting/domain/hash.ts, S04.06): 64 lower-case hex digits. */
  contentHash: string;
  smsBodies: Readonly<Record<string, FrozenSmsBody>>;
  translations: readonly FrozenTranslation[];
}

/** What a freeze refuses, naming the language and never the text (S04.06). */
export type FreezeRefusal = "SMS_BODY_TOO_LONG" | "TRANSLATION_STALE";

/** A frozen content, or why nothing was frozen. */
export type FreezeResult = { ok: true; value: FrozenContent } | { ok: false; error: FreezeRefusal; lang: string };

/**
 * What the preparation of an entry needs to know besides its content (S04.05, AD-21): which entry it is, what kind, what it
 * replaces (nothing yet: correction and withdrawal are E05's), where it goes, how the texts describe its origin and what
 * public link they carry. Every one of these is read from the database by the use case, never taken from the request.
 */
export interface PrepareContext {
  alertId: string;
  entryId: string;
  isDrill: boolean;
  kind: EntryKind;
  /** The entry a correction or withdrawal replaces; null for every other entry. */
  supersedesId: string | null;
  /** What the entry goes out on (the hash covers it). */
  channels: readonly string[];
  /** The thread's public slug: the texts link to `/a/{slug}`. */
  slug: string;
  /** "Verified by the Hub" in the texts when true: true for every entry the Hub's staff approve (epic E04, Verification marker). */
  verified: boolean;
  attribution: SmsAttribution;
}

/** What a submit watches of the preparation while it runs outside any lock. */
export interface PrepareHooks {
  /** Aborts what is still running (the languages still translating end as the English fallback at once). */
  signal?: AbortSignal;
  /** Called as each language settles, so a screen can show progress per language. */
  onLanguage?: (translation: FrozenTranslation) => void;
  /** Called once the submit budget is known (the longest route deadline plus 5 s), before any model is asked. */
  onBudget?: (budgetMs: number) => void;
  /**
   * Milliseconds of the press already used when the preparation starts (the transaction that began the attempt). The budget is counted
   * from the press, not from the models being asked, so the translation's stop comes that much sooner.
   */
  spentMs?: number;
}

/**
 * Port: translate, render and hash an entry's draft content. Slow (it calls the translation models), so it runs outside any
 * database lock and transaction. It returns the frozen content, or the refusal that stopped the freeze (a text message
 * body over Twilio's limit in one language; a translation made from other English than the draft's: SMS_BODY_TOO_LONG and
 * TRANSLATION_STALE reach the author as a refusal to submit). It rejects, with nothing frozen, when it cannot do its work:
 * translation's AlertRoutesUnavailableError (`translation_route` could not be read in time) and RouteConfigError (a row that
 * is not a route) are refused by name with their own message and an ops event, never turned into a half result; anything
 * else is a failed preparation.
 */
export interface EntryPreparer {
  prepare(content: EntryContent, context: PrepareContext, hooks?: PrepareHooks): Promise<FreezeResult>;
}
