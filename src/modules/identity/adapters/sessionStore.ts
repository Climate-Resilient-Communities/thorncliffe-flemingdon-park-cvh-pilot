import { and, eq, isNull, lt, ne } from "drizzle-orm";
import type { StaffSessionStore } from "../application/ports";
import { staffSession } from "./schema";

/** A request seen within this long of the last recorded one is not written again. */
const TOUCH_INTERVAL_MS = 60_000;

/** The staff sessions the app opened, through Drizzle (S01.07). */
export const drizzleStaffSessionStore: StaffSessionStore = {
  async insert(tx, session) {
    await tx.insert(staffSession).values({ id: session.id, staffAccountId: session.staffId, createdAt: session.at, lastSeenAt: session.at });
  },

  async find(db, id) {
    const [row] = await db.select().from(staffSession).where(eq(staffSession.id, id)).limit(1);
    return row
      ? { id: row.id, staffId: row.staffAccountId, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, revokedAt: row.revokedAt, aal2At: row.aal2At }
      : null;
  },

  async touch(db, id, at) {
    await db
      .update(staffSession)
      .set({ lastSeenAt: at })
      .where(and(eq(staffSession.id, id), isNull(staffSession.revokedAt), lt(staffSession.lastSeenAt, new Date(at.getTime() - TOUCH_INTERVAL_MS))));
  },

  async replace(tx, from, to) {
    const [old] = await tx
      .update(staffSession)
      .set({ revokedAt: to.at })
      .where(and(eq(staffSession.id, from), eq(staffSession.staffAccountId, to.staffId)))
      .returning({ createdAt: staffSession.createdAt });
    const createdAt = old && old.createdAt < to.at ? old.createdAt : to.at;
    await tx.insert(staffSession).values({ id: to.id, staffAccountId: to.staffId, createdAt, lastSeenAt: to.at });
  },

  async revoke(db, id, at) {
    const rows = await db
      .update(staffSession)
      .set({ revokedAt: at })
      .where(and(eq(staffSession.id, id), isNull(staffSession.revokedAt)))
      .returning({ id: staffSession.id });
    return rows.length > 0;
  },

  async markAal2(tx, id, staffId, at) {
    const rows = await tx
      .update(staffSession)
      .set({ aal2At: at })
      .where(and(eq(staffSession.id, id), eq(staffSession.staffAccountId, staffId), isNull(staffSession.revokedAt)))
      .returning({ id: staffSession.id });
    return rows.length > 0;
  },

  async revokeAll(db, staffId, at, options = {}) {
    const rows = await db
      .update(staffSession)
      .set({ revokedAt: at })
      .where(and(eq(staffSession.staffAccountId, staffId), isNull(staffSession.revokedAt), options.keep === undefined ? undefined : ne(staffSession.id, options.keep)))
      .returning({ id: staffSession.id });
    return rows.length;
  },
};
