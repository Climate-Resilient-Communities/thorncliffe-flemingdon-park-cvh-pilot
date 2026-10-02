import type { AssuranceLevel } from "../../../contracts/staffAuth";
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import type { AuditEvent } from "../../audit";
import type { StaffStanding } from "../../identity";
import type { EntryContent } from "../domain/content";
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

/** One language's web text, frozen with the entry (`alert_entry_translation`). */
export interface FrozenTranslation {
  lang: string;
  body: string;
  /** True for a machine translation; its label is shown with it. */
  machine: boolean;
  /** The model that produced it; null for a script conversion or a fallback. */
  model: string | null;
  /** `fallback_en`: every model in the route failed, so the text is English with `translation.unavailable`. */
  status: "translated" | "fallback_en" | "script_converted";
  /** SHA-256 of the English source text it was made from. */
  sourceHash: string;
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

/**
 * Port: translate, render and hash an entry's draft content. Slow (it calls the translation
 * models), so it runs outside any database lock and transaction; "Try translation again" calls it
 * between its two short transactions. S04.02 and S04.06 provide the real one.
 */
export interface EntryPreparer {
  prepare(content: EntryContent, context: { alertId: string; entryId: string; isDrill: boolean }): Promise<FrozenContent>;
}
