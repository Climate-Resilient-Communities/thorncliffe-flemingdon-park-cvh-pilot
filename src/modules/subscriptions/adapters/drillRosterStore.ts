import { asc, count, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import type { LangCode } from "../../../contracts/lang";
import { drillRoster } from "./schema";

/** A roster row as the store gives it: the number is here and goes no further than the use cases that mask it or hand it to the resolver. */
export interface DrillRosterRow {
  id: string;
  label: string;
  phone: string;
  lang: LangCode;
  createdAt: Date;
}

/** The roster's id and language: what a drill's approval needs, and no number. */
export interface DrillMember {
  id: string;
  lang: LangCode;
}

/** The drill roster's statements. Every one runs in the caller's executor; the number is never selected for anything but the uses named in the header of application/drillRoster.ts. */
export const drillRosterStore = {
  async list(executor: DbExecutor): Promise<DrillRosterRow[]> {
    const rows = await executor
      .select({ id: drillRoster.id, label: drillRoster.label, phone: drillRoster.phone, lang: drillRoster.lang, createdAt: drillRoster.createdAt })
      .from(drillRoster)
      .orderBy(asc(drillRoster.createdAt), asc(drillRoster.id));
    return rows.map((row) => ({ ...row, lang: row.lang as LangCode }));
  },

  /** The members' ids and languages, in a fixed order, no number read (the reviewed count of a drill's approval). */
  async members(executor: DbExecutor): Promise<DrillMember[]> {
    const rows = await executor.select({ id: drillRoster.id, lang: drillRoster.lang }).from(drillRoster).orderBy(asc(drillRoster.createdAt), asc(drillRoster.id));
    return rows.map((row) => ({ id: row.id, lang: row.lang as LangCode }));
  },

  /**
   * The same, with each row locked `FOR SHARE` (the approval's capture): a member removed or changed meanwhile waits for the approval to commit, and a
   * member the approval captured is still on the roster when its text is written. No number is read.
   */
  async membersForShare(tx: DbTransaction): Promise<DrillMember[]> {
    const rows = await tx
      .select({ id: drillRoster.id, lang: drillRoster.lang })
      .from(drillRoster)
      .orderBy(asc(drillRoster.createdAt), asc(drillRoster.id))
      .for("share");
    return rows.map((row) => ({ id: row.id, lang: row.lang as LangCode }));
  },

  /** The labels of some members by id (a drill's results name members by what the Hub calls them, never by number). */
  async labelsOf(executor: DbExecutor, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await executor.select({ id: drillRoster.id, label: drillRoster.label }).from(drillRoster).where(inArray(drillRoster.id, [...ids]));
    return new Map(rows.map((row) => [row.id, row.label]));
  },

  /** One change to the roster at a time: the size limit and the duplicate check hold when two Admins press at once. */
  async lockForChange(tx: DbTransaction): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('drill_roster'))`);
  },

  async size(tx: DbExecutor): Promise<number> {
    const [row] = await tx.select({ n: count() }).from(drillRoster);
    return Number(row?.n ?? 0);
  },

  /** The new row's id, or null when the number is already on the roster. */
  async insert(tx: DbTransaction, row: { id: string; label: string; phone: string; lang: LangCode; addedBy: string }): Promise<string | null> {
    const inserted = await tx.insert(drillRoster).values(row).onConflictDoNothing({ target: drillRoster.phone }).returning({ id: drillRoster.id });
    return inserted[0]?.id ?? null;
  },

  /** The row's label when it exists; never its number. Every change runs under `lockForChange`, so the row is still there when it is changed or deleted next. */
  async labelOf(tx: DbTransaction, id: string): Promise<string | null> {
    const [row] = await tx.select({ label: drillRoster.label }).from(drillRoster).where(eq(drillRoster.id, id));
    return row?.label ?? null;
  },

  /** The row's label, taking the row's lock: it waits for an approval that holds the member `FOR SHARE` and commits behind it. */
  async labelOfLocked(tx: DbTransaction, id: string): Promise<string | null> {
    const [row] = await tx.select({ label: drillRoster.label }).from(drillRoster).where(eq(drillRoster.id, id)).for("update");
    return row?.label ?? null;
  },

  /** Whether another row already has this number (the row `except` is the one being changed). */
  async numberTakenByAnother(tx: DbTransaction, phone: string, except: string): Promise<boolean> {
    const [row] = await tx.select({ id: drillRoster.id }).from(drillRoster).where(eq(drillRoster.phone, phone));
    return row !== undefined && row.id !== except;
  },

  async update(tx: DbTransaction, id: string, change: { label: string; phone: string | null; lang: LangCode }): Promise<void> {
    await tx
      .update(drillRoster)
      .set({ label: change.label, lang: change.lang, ...(change.phone === null ? {} : { phone: change.phone }), updatedAt: sql`now()` })
      .where(eq(drillRoster.id, id));
  },

  async delete(tx: DbTransaction, id: string): Promise<void> {
    await tx.delete(drillRoster).where(eq(drillRoster.id, id));
  },

  /** The number of one entry, for the resolver's source only. Null when the entry is gone. */
  async phoneOf(tx: DbTransaction, id: string): Promise<string | null> {
    const [row] = await tx.select({ phone: drillRoster.phone }).from(drillRoster).where(eq(drillRoster.id, id));
    return row?.phone ?? null;
  },
};
