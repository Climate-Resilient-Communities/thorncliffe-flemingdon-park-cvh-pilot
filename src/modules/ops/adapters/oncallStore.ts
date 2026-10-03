import { asc, count, eq, sql } from "drizzle-orm";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { oncallRoster } from "./schema";

/** A roster row as the store gives it: the number is here and goes no further than the use cases that mask it or hand it to the resolver. */
export interface RosterRow {
  id: string;
  label: string;
  phone: string;
  createdAt: Date;
}

/** The on-call roster's statements. Every one runs in the caller's executor; the number is never selected for anything but the two uses in the header of oncallRoster.ts. */
export const oncallStore = {
  async list(executor: DbExecutor): Promise<RosterRow[]> {
    return executor
      .select({ id: oncallRoster.id, label: oncallRoster.label, phone: oncallRoster.phone, createdAt: oncallRoster.createdAt })
      .from(oncallRoster)
      .orderBy(asc(oncallRoster.createdAt), asc(oncallRoster.id));
  },

  /** Whether at least one number is on the roster (no number is read). */
  async any(executor: DbExecutor): Promise<boolean> {
    const [row] = await executor.select({ id: oncallRoster.id }).from(oncallRoster).limit(1);
    return row !== undefined;
  },

  /** One change to the roster at a time: the size limit and the duplicate check hold when two Admins press at once. */
  async lockForChange(tx: DbTransaction): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('oncall_roster'))`);
  },

  async size(tx: DbTransaction): Promise<number> {
    const [row] = await tx.select({ n: count() }).from(oncallRoster);
    return Number(row?.n ?? 0);
  },

  /** The new row's id, or null when the number is already on the roster. */
  async insert(tx: DbTransaction, row: { id: string; label: string; phone: string; addedBy: string }): Promise<string | null> {
    const inserted = await tx.insert(oncallRoster).values(row).onConflictDoNothing({ target: oncallRoster.phone }).returning({ id: oncallRoster.id });
    return inserted[0]?.id ?? null;
  },

  /**
   * The row's label when it exists; never its number. No row lock is taken (a `FOR UPDATE` needs the UPDATE privilege, which the app does not have on
   * this table): every change to the roster runs under `lockForChange`, so the row is still there when it is deleted next.
   */
  async labelOf(tx: DbTransaction, id: string): Promise<string | null> {
    const [row] = await tx.select({ label: oncallRoster.label }).from(oncallRoster).where(eq(oncallRoster.id, id));
    return row?.label ?? null;
  },

  async delete(tx: DbTransaction, id: string): Promise<void> {
    await tx.delete(oncallRoster).where(eq(oncallRoster.id, id));
  },

  /** The number of one entry, for the resolver's source only. Null when the entry is gone. */
  async phoneOf(tx: DbTransaction, id: string): Promise<string | null> {
    const [row] = await tx.select({ phone: oncallRoster.phone }).from(oncallRoster).where(eq(oncallRoster.id, id));
    return row?.phone ?? null;
  },

  /** The ids of the roster, in the order the health job texts them (no number is read). */
  async ids(executor: DbExecutor): Promise<string[]> {
    const rows = await executor.select({ id: oncallRoster.id }).from(oncallRoster).orderBy(asc(oncallRoster.createdAt), asc(oncallRoster.id));
    return rows.map((row) => row.id);
  },
};
