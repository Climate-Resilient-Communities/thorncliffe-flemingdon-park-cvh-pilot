// The Hub and partner space against a real database (2026-11-07): the seed of data/partners/seed.json (as the migration role, like
// scripts/seed/partners.mjs), a space's change by a Hub account (as cvh_app_login, the app's own role) with its history row and audit record,
// what residents are shown, and what the app's role may and may not do to the tables.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import {
  changeSpace,
  decisionsOf,
  listCommitments,
  listOrgs,
  listSpaces,
  openSharedSpace,
  parsePartnerSeed,
  readLookBack,
  readSpace,
  residentSpaces,
  seedPartners,
  statementsOf,
} from "@/modules/partners";
import { createDb, type Db } from "@/platform/db";
import { ROOT, connect, serverUrl } from "./helpers";

const SEED = parsePartnerSeed(JSON.parse(readFileSync(path.join(ROOT, "data", "partners", "seed.json"), "utf8")));
const NOW = new Date("2026-11-07T18:00:00Z");

describe("partner space (2026-11-07)", () => {
  // The migrations enable pg_cron, which Supabase allows only in the `postgres` database, so (like the other seeds' tests) this migrates the
  // test server's `postgres` database and empties the tables after.
  let sql: ReturnType<typeof connect>;
  let owner: Db;
  let app: Db;
  let appSql: ReturnType<typeof connect>;
  let auditBaseline = 0;
  let mark = 0;
  const staffId = randomUUID();
  const actor = { staffId, label: "Ann Okafor, the Hub" };

  async function wipe() {
    await sql.unsafe(
      "delete from partner_statement; delete from partner_decision; delete from partner_handover; delete from shared_space; delete from partner_commitment; delete from partner_supply; delete from playbook; delete from partner_team; delete from partner_exercise; delete from partner_indicator; delete from look_back_record; delete from look_back_action; delete from space_change; delete from space; delete from partner_org",
    );
  }

  beforeAll(async () => {
    sql = connect(serverUrl());
    await migrate({ sql });
    [{ max: auditBaseline }] = await sql`select coalesce(max(id), 0)::int as max from audit_event`;
    const password = randomBytes(18).toString("hex");
    await sql.unsafe(`alter role cvh_app_login password '${password}'`);
    const url = new URL(serverUrl());
    url.username = "cvh_app_login";
    url.password = password;
    owner = createDb(serverUrl());
    app = createDb(url.href);
    appSql = connect(url.href);
    await sql`
      insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
      values (${staffId}, ${randomUUID()}, ${`coord${randomBytes(3).toString("hex")}`}, 'Ann', 'Okafor', 'someone@example.org', 'coordinator', false)`;
  });

  afterAll(async () => {
    await wipe();
    await sql.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await sql`delete from audit_event where id > ${auditBaseline}`;
    await sql.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await sql`delete from staff_account where id = ${staffId}`;
    await sql.unsafe("alter role cvh_app_login password null");
    await appSql.end({ timeout: 5 });
    await app.$client.end({ timeout: 5 });
    await owner.$client.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await wipe();
    await seedPartners(owner, SEED, { now: NOW });
    [{ max: mark }] = await sql`select coalesce(max(id), 0)::int as max from audit_event`;
  });

  const audits = async () => (await sql.unsafe("select action, subject_id, outcome, meta from audit_event where id > $1 order by id", [mark])).map((row) => ({ ...row }));

  describe("the seed", () => {
    it("loads the whole file, with times counted back from when it runs", async () => {
      expect((await listOrgs(app)).map((org) => org.id)).toEqual(SEED.orgs.map((org) => org.id));
      const spaces = await listSpaces(app);
      expect(spaces).toHaveLength(SEED.spaces.length);
      const jenner = spaces.find((s) => s.providerId === "M052");
      expect(jenner).toMatchObject({ id: "SP03", status: "open", purpose: "warming", capacityNow: 31, capacityMax: 60, orgShortName: "the City", confirmedBy: "Kwame O., the City" });
      expect(jenner?.confirmedAt?.toISOString()).toBe(new Date(NOW.getTime() - 50 * 60_000).toISOString());
      const shared = await openSharedSpace(app);
      expect(shared).toMatchObject({ id: "SH01", hazard: "power", level: 2 });
      expect((await statementsOf(app, "SH01")).map((s) => s.id)[0]).toBe("ST14");
      expect((await statementsOf(app, "SH01")).find((s) => s.id === "ST04")?.answers).toBe("ST03");
      expect(await decisionsOf(app, "SH01")).toHaveLength(SEED.decisions.length);
      expect(await listCommitments(app)).toHaveLength(SEED.commitments.length);
      const lookBack = await readLookBack(app);
      expect(lookBack.actions[0].status).toBe("open");
      // The seeded status is each space's first change, by the seeded contact and no Hub account.
      const [{ count }] = await sql`select count(*)::int as count from space_change where changed_by is null`;
      expect(count).toBe(SEED.spaces.length);
    });

    it("keeps the status staff gave a space when it runs again, and puts it back with resetStatus", async () => {
      expect((await changeSpace(app, actor, "SP03", { status: "full", purpose: "warming", capacityMax: "60", capacityNow: "60" }, { now: () => NOW })).ok).toBe(true);
      const again = await seedPartners(owner, SEED, { now: NOW });
      expect(again.spaces).toEqual({ added: 0, kept: SEED.spaces.length, reset: 0 });
      expect((await readSpace(app, "SP03"))?.space).toMatchObject({ status: "full", capacityNow: 60, confirmedBy: "Ann Okafor, the Hub" });
      const reset = await seedPartners(owner, SEED, { now: NOW, resetStatus: true });
      expect(reset.spaces.reset).toBe(SEED.spaces.length);
      expect((await readSpace(app, "SP03"))?.space).toMatchObject({ status: "open", capacityNow: 31 });
    });
  });

  describe("a space's change (P-01, P-06, P-07)", () => {
    it("sets the status, purpose and capacity, confirms it as the person who changed it, and records the change and the audit in one go", async () => {
      const at = new Date("2026-11-07T18:30:00Z");
      const result = await changeSpace(app, actor, "SP08", { status: "open", purpose: "warming", capacityMax: "80", capacityNow: "12" }, { now: () => at });
      expect(result).toMatchObject({ ok: true, space: { id: "SP08", status: "open", purpose: "warming", capacityNow: 12, capacityMax: 80, confirmedBy: "Ann Okafor, the Hub" } });
      const read = await readSpace(app, "SP08");
      expect(read?.space.confirmedAt?.toISOString()).toBe(at.toISOString());
      expect(read?.changes[0]).toMatchObject({ status: "open", purpose: "warming", capacityNow: 12, by: "Ann Okafor, the Hub" });
      const [{ updated_by }] = await sql`select updated_by from space where id = 'SP08'`;
      expect(updated_by).toBe(staffId);
      expect(await audits()).toEqual([
        { action: "space.status_set", subject_id: "SP08", outcome: "ok", meta: { status: "open", previous: "not_activated", purpose: "warming", capacity_max: 80, capacity_now: 12 } },
      ]);
      // Open now, at a place of the directory: residents are shown it.
      expect((await residentSpaces(app)).find((s) => s.providerId === "M055")).toMatchObject({ status: "open", purpose: "warming" });
    });

    it("drops the count when a space closes, and residents no longer see it", async () => {
      expect((await changeSpace(app, actor, "SP03", { status: "closed", purpose: "warming", capacityMax: "60", capacityNow: "31" })).ok).toBe(true);
      expect((await readSpace(app, "SP03"))?.space).toMatchObject({ status: "closed", capacityNow: null });
      expect((await residentSpaces(app)).some((s) => s.providerId === "M052")).toBe(false);
    });

    it("refuses a count over the limit and an unknown space, changes nothing and audits the refusal", async () => {
      expect(await changeSpace(app, actor, "SP03", { status: "open", purpose: "warming", capacityMax: "60", capacityNow: "61" })).toEqual({ ok: false, error: "capacity_over" });
      expect(await changeSpace(app, actor, "SP99", { status: "open", purpose: "warming", capacityMax: "60", capacityNow: "" })).toEqual({ ok: false, error: "not_found" });
      expect((await readSpace(app, "SP03"))?.space).toMatchObject({ status: "open", capacityNow: 31 });
      expect(await audits()).toEqual([
        { action: "space.status_set", subject_id: "SP03", outcome: "refused", meta: { reason: "validation", code: "capacity_over" } },
        { action: "space.status_set", subject_id: "SP99", outcome: "refused", meta: { reason: "not_found" } },
      ]);
    });
  });

  describe("what residents are shown (GET /api/spaces)", () => {
    it("lists only the open and full spaces at a place of the directory, by place", async () => {
      const shown = await residentSpaces(app);
      expect(shown.map((s) => [s.providerId, s.status, s.purpose])).toEqual([
        ["M049", "open", "charging"],
        ["M052", "open", "warming"],
        ["M053", "full", "warming"],
        ["M054", "open", "warming"],
        ["M056", "open", "charging"],
        ["M061", "open", "charging"],
      ]);
    });
  });

  describe("the app's database role", () => {
    it("may change only a space's status columns and add its changes, and nothing of the coordination records", async () => {
      await expect(appSql`update space set name = 'Renamed' where id = 'SP01'`).rejects.toThrow(/permission denied/);
      await expect(appSql`update space set provider_id = 'M001' where id = 'SP01'`).rejects.toThrow(/permission denied/);
      await expect(appSql`delete from space where id = 'SP01'`).rejects.toThrow(/permission denied/);
      await expect(appSql`update partner_statement set body = 'x'`).rejects.toThrow(/permission denied/);
      await expect(appSql`insert into partner_decision (id, shared_space_id, org_id, person, decided_at, body, why) values ('DEC99', 'SH01', 'HUB', 'x', now(), 'x', 'x')`).rejects.toThrow(/permission denied/);
      await expect(appSql`update space_change set status = 'open'`).rejects.toThrow(/permission denied/);
    });

    it("cannot leave a space open with nobody's confirmation, nor count people in a closed one", async () => {
      await expect(appSql`update space set status = 'open', confirmed_at = null where id = 'SP08'`).rejects.toThrow(/space_confirmed_when_open/);
      await expect(appSql`update space set status = 'closed', capacity_now = 3 where id = 'SP03'`).rejects.toThrow(/space_capacity_now_when_open/);
    });

    it("refuses a real-looking number or address for an organisation's contact", async () => {
      await expect(sql`update partner_org set contact_phone = '(416) 396-2874' where id = 'HUB'`).rejects.toThrow(/partner_org_phone_fictional/);
      await expect(sql`update partner_org set contact_email = 'someone@gmail.com' where id = 'HUB'`).rejects.toThrow(/partner_org_email_fictional/);
    });
  });
});
