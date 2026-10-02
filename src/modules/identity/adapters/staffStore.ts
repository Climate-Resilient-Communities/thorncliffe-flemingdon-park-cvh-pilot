import { eq, sql } from "drizzle-orm";
import type { StaffStore } from "../application/ports";
import { staffAccount, staffBootstrap } from "./schema";

// Any fixed key: it only serialises the identity module's account writers.
const ACCOUNTS_LOCK_KEY = 7_315_420_052;

/** The identity module's tables through Drizzle, in whatever executor it is given. */
export const drizzleStaffStore: StaffStore = {
  async findById(db, id) {
    const [row] = await db.select().from(staffAccount).where(eq(staffAccount.id, id)).limit(1);
    if (!row) return null;
    return {
      id: row.id,
      authUserId: row.authUserId,
      username: row.username,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      role: row.role,
      status: row.status,
      mustChangePassword: row.mustChangePassword,
      startingPasswordIssuedAt: row.startingPasswordIssuedAt,
    };
  },

  async usernameTaken(db, username) {
    const rows = await db.select({ id: staffAccount.id }).from(staffAccount).where(eq(staffAccount.username, username)).limit(1);
    return rows.length > 0;
  },

  async adminExists(db) {
    const rows = await db.select({ id: staffAccount.id }).from(staffAccount).where(eq(staffAccount.role, "admin")).limit(1);
    return rows.length > 0;
  },

  async readBootstrap(db) {
    const [row] = await db.select().from(staffBootstrap).limit(1);
    if (!row) return null;
    return { firstAdminId: row.firstAdminId, secondAdminId: row.secondAdminId, completedAt: row.completedAt };
  },

  async lockAccounts(tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(${ACCOUNTS_LOCK_KEY})`);
  },

  async insertAccount(tx, row) {
    await tx.insert(staffAccount).values({
      id: row.id,
      authUserId: row.authUserId,
      username: row.username,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      role: row.role,
      status: "active",
      mustChangePassword: true,
      startingPasswordIssuedAt: row.startingPasswordIssuedAt,
      createdBy: row.createdBy,
    });
  },

  async startBootstrap(tx, firstAdminId) {
    await tx.insert(staffBootstrap).values({ firstAdminId });
  },

  async setSecondAdmin(tx, secondAdminId) {
    await tx.update(staffBootstrap).set({ secondAdminId }).where(eq(staffBootstrap.singleton, true));
  },

  async completeBootstrap(tx) {
    await tx.update(staffBootstrap).set({ completedAt: sql`now()` }).where(eq(staffBootstrap.singleton, true));
  },
};
