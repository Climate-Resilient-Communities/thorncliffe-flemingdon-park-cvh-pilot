// The provider catalogue against a real database (S02.04): the seed (as the migration role, like
// scripts/seed/providers.mjs) and the Admin's changes (as cvh_app_login, the app's own role). Covers
// the idempotent upsert on the real data/catalogue files, the schema refusals, removed providers,
// the Admins' fields surviving a re-run, the publish/confirm rules with their audit records, and
// what the app's role may and may not do to the tables.
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { record } from "@/modules/audit";
import {
  ProviderSeedRefusedError,
  confirmProvider,
  listProviders,
  publishProvider,
  readProviderCatalogue,
  seedProviders,
  unpublishProvider,
  type ProviderCatalogueInput,
} from "@/modules/directory";
import { catalogueTextId } from "@/modules/directory/adapters/hash";
import { createDb, type Db } from "@/platform/db";
import { ROOT, connect, serverUrl } from "./helpers";

// The real audit module (S01.04) writes audit_event; the spy only lets one test make it fail.
vi.mock("@/modules/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/audit")>();
  return { ...actual, record: vi.fn(actual.record) };
});

const LABELS = (names: string[]) => Object.fromEntries(names.map((name) => [name, { id: catalogueTextId(name), en: name }]));

function entry(id: string, change: Record<string, unknown> = {}) {
  return {
    id,
    name: `Provider ${id}`,
    categories: ["Health & Wellness"],
    subcategories: ["Health Clinics"],
    address: { street: `${id} Overlea Blvd`, city: "East York", postal: "M4H 1C6" },
    location: { lat: 43.7, lng: -79.34 },
    contact: { phone: ["416-555-0100"], email: [], social: [], web: [] },
    services: { id: catalogueTextId(`Services of ${id}`), en: `Services of ${id}` },
    emergencyRole: null,
    sourceNotes: [],
    lastConfirmed: null,
    ...change,
  };
}

function input(providers: unknown[], translations: ProviderCatalogueInput["translations"] = {}): ProviderCatalogueInput {
  return {
    catalogue: {
      labels: { categories: LABELS(["Health & Wellness", "Non-Profits"]), subcategories: LABELS(["Health Clinics"]) },
      providers,
    },
    translations,
  };
}

const TODAY = "2026-10-02";
const NOW = () => new Date("2026-10-02T15:00:00Z");

describe("provider catalogue (S02.04)", () => {
  // The migrations enable pg_cron, which Supabase allows only in the `postgres` database, so (like
  // the guides test) this migrates the test server's `postgres` database and empties the tables after.
  let sql: ReturnType<typeof connect>;
  let owner: Db;
  let app: Db;
  let appSql: ReturnType<typeof connect>;
  let auditBaseline = 0;
  // The audit trail is append-only: each test reads only what was written since it began.
  let mark = 0;
  const staffId = randomUUID();
  const audit = vi.mocked(record);

  async function wipe() {
    await sql.unsafe("delete from provider_category; delete from provider_location; delete from provider; delete from category");
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
      values (${staffId}, ${randomUUID()}, ${`admin${randomBytes(3).toString("hex")}`}, 'Ann', 'Okafor', 'someone@example.org', 'admin', false)`;
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
    audit.mockClear();
    await wipe();
    [{ max: mark }] = await sql`select coalesce(max(id), 0)::int as max from audit_event`;
  });

  const seed = (catalogue: ProviderCatalogueInput) => seedProviders(owner, catalogue);
  const providers = () => sql.unsafe("select * from provider order by id");
  const everything = async () => ({
    providers: await providers(),
    locations: await sql.unsafe("select * from provider_location order by provider_id, seq"),
    categories: await sql.unsafe("select * from category order by sort_order"),
    links: await sql.unsafe("select * from provider_category order by provider_id, category_id"),
  });
  const seedRuns = async () =>
    (await sql.unsafe("select outcome, meta from audit_event where id > $1 and action = 'seed.run' and subject_type = 'provider_catalogue' order by id", [mark])).map((e) => ({ ...e }));
  const auditOf = async (action: string) =>
    (await sql.unsafe("select actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > $1 and action = $2 order by id", [mark, action])).map((e) => ({ ...e }));
  // last_confirmed as text: the driver would hand a date column back as a JavaScript Date.
  const row = async (id: string) => (await sql.unsafe("select *, last_confirmed::text as last_confirmed from provider where id = $1", [id]))[0];

  describe("the tables", () => {
    it("have row level security, no access for the client roles, select for the app and update of the Admins' columns only", async () => {
      const tables = ["provider", "provider_location", "category", "provider_category"];
      const rls = await sql.unsafe("select relname, relrowsecurity as rls from pg_class where relname = any($1) and relkind = 'r' order by 1", [tables]);
      expect(rls.map((t) => ({ ...t }))).toEqual([...tables].sort().map((relname) => ({ relname, rls: true })));

      const clients = await sql.unsafe(
        `select r.rolname, c.relname, has_table_privilege(r.oid, c.oid, 'select, insert, update, delete, truncate, references, trigger') as any_access
         from pg_roles r, pg_class c
         where r.rolname in ('anon', 'authenticated', 'service_role') and c.relname = any($1) and c.relkind = 'r'`,
        [tables],
      );
      expect(clients.filter((c) => c.any_access)).toEqual([]);

      const app = await sql.unsafe(
        `select c.relname,
                has_table_privilege('cvh_app', c.oid, 'select') as can_select,
                has_table_privilege('cvh_app', c.oid, 'insert') as can_insert,
                has_table_privilege('cvh_app', c.oid, 'delete') as can_delete
         from pg_class c where c.relname = any($1) and c.relkind = 'r' order by 1`,
        [tables],
      );
      expect(app.map((t) => ({ ...t }))).toEqual([...tables].sort().map((relname) => ({ relname, can_select: true, can_insert: false, can_delete: false })));

      const columns = await sql.unsafe(
        `select a.attname from pg_attribute a where a.attrelid = 'provider'::regclass and a.attnum > 0 and not a.attisdropped
           and has_column_privilege('cvh_app', 'provider', a.attname, 'update') order by 1`,
      );
      expect(columns.map((c) => c.attname)).toEqual(["last_confirmed", "published", "published_at", "updated_at"]);
    });

    it("have no sequences, so there is nothing for a client role to burn", async () => {
      const sequences = await sql.unsafe(
        `select c.relname from pg_class c join pg_depend d on d.objid = c.oid join pg_class t on t.oid = d.refobjid
         where c.relkind = 'S' and t.relname in ('provider', 'provider_location', 'category', 'provider_category')`,
      );
      expect(sequences).toHaveLength(0);
    });

    it("refuse a published provider with no last-confirmed date, one outside the catalogue, and coordinates outside Toronto", async () => {
      await sql.unsafe("insert into provider (id, name, texts) values ('M001', 'A', '{}')");

      await expect(sql.unsafe("update provider set published = true, published_at = now() where id = 'M001'")).rejects.toThrow(/provider_published_after_confirmation/);
      await expect(sql.unsafe("update provider set last_confirmed = '2026-10-01', in_catalogue = false, published = true, published_at = now() where id = 'M001'")).rejects.toThrow(/provider_published_in_catalogue/);
      await expect(sql.unsafe("update provider set last_confirmed = '2026-10-01', published = true where id = 'M001'")).rejects.toThrow(/provider_published_at_when_published/);
      await expect(sql.unsafe("insert into provider (id, name, texts) values ('bad', 'B', '{}')")).rejects.toThrow(/provider_id_format/);
      await expect(sql.unsafe("insert into provider_location (provider_id, street, city, lat, lng) values ('M001', 's', 'c', 45.4, -75.7)")).rejects.toThrow(/provider_location_in_toronto/);
    });
  });

  describe("the last-confirmed date guard", () => {
    const toronto = async (days: number) =>
      (await sql.unsafe("select ((now() at time zone 'America/Toronto')::date + $1::int)::text as day", [days]))[0].day as string;

    it("refuses a date after today in Toronto, on update and on insert, for the owner and for the app's role", async () => {
      await sql.unsafe("insert into provider (id, name, texts) values ('M001', 'A', '{}')");
      const tomorrow = await toronto(1);

      await expect(sql.unsafe(`update provider set last_confirmed = '${tomorrow}' where id = 'M001'`)).rejects.toThrow(/cannot be in the future/);
      await expect(appSql.unsafe(`update provider set last_confirmed = '${tomorrow}' where id = 'M001'`)).rejects.toThrow(/cannot be in the future/);
      await expect(sql.unsafe(`update provider set last_confirmed = '2099-01-01' where id = 'M001'`)).rejects.toThrow(/cannot be in the future/);
      await expect(sql.unsafe(`insert into provider (id, name, texts, last_confirmed) values ('M002', 'B', '{}', '${tomorrow}')`)).rejects.toThrow(/cannot be in the future/);
      expect((await row("M001")).last_confirmed).toBeNull();
    });

    it("accepts today in Toronto and any earlier date, and an update of other columns on a row that has one", async () => {
      await sql.unsafe("insert into provider (id, name, texts) values ('M001', 'A', '{}')");

      await expect(appSql.unsafe(`update provider set last_confirmed = '${await toronto(0)}' where id = 'M001'`)).resolves.toBeDefined();
      await expect(appSql.unsafe("update provider set last_confirmed = '2020-02-29' where id = 'M001'")).resolves.toBeDefined();
      await expect(sql.unsafe("update provider set name = 'B' where id = 'M001'")).resolves.toBeDefined();
    });

    it("keeps the guard function out of reach of the client roles, with its search_path pinned", async () => {
      const [fn] = await sql.unsafe(`
        select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
               has_function_privilege('public', p.oid, 'EXECUTE') as public,
               p.proconfig as config
        from pg_proc p where p.proname = 'provider_last_confirmed_not_future'`);

      expect(fn).toMatchObject({ anon: false, authenticated: false, public: false });
      expect(fn.config).toContain('search_path=""');
    });
  });

  describe("the seed", () => {
    it("loads the real data/catalogue files, and running it twice changes nothing", async () => {
      const files = readProviderCatalogue(path.join(ROOT, "data", "catalogue"));

      const first = await seed(files);
      const afterFirst = await everything();
      const second = await seed(files);
      const afterSecond = await everything();

      expect(first.changed).toEqual({ providers: 99, locations: 99, categories: 8, categoryLinks: 122 });
      expect(first.removed).toEqual({ flagged: 0, unpublished: 0 });
      expect(second.changed).toEqual({ providers: 0, locations: 0, categories: 0, categoryLinks: 0 });
      expect(afterSecond).toEqual(afterFirst);
      expect(afterFirst.providers).toHaveLength(99);
      expect(afterFirst.locations).toHaveLength(99);
      expect(afterFirst.categories).toHaveLength(8);
      expect(afterFirst.links).toHaveLength(122);
      // Nothing is published and nothing is confirmed until an Admin does it, whatever the file says.
      expect(afterFirst.providers.every((p) => p.published === false && p.last_confirmed === null && p.in_catalogue === true)).toBe(true);
    });

    it("stores a provider that is in several categories once, linked to each", async () => {
      const files = readProviderCatalogue(path.join(ROOT, "data", "catalogue"));
      await seed(files);

      const multi = await sql.unsafe("select provider_id, count(*)::int as n from provider_category group by 1 having count(*) > 1 order by 1");
      expect(multi.length).toBe(20);
      const [{ n }] = await sql.unsafe("select count(*)::int as n from provider where id = $1", [multi[0].provider_id]);
      expect(n).toBe(1);
    });

    it("audits seed.run with counts, every run", async () => {
      const files = readProviderCatalogue(path.join(ROOT, "data", "catalogue"));
      await seed(files);
      await seed(files);

      const runs = await seedRuns();
      expect(runs).toHaveLength(2);
      expect(runs[0]).toEqual({
        outcome: "ok",
        meta: {
          seed: "provider_catalogue",
          counts: {
            providers_loaded: 99,
            providers_changed: 99,
            providers_not_in_catalogue: 0,
            providers_unpublished: 0,
            locations_changed: 99,
            categories_loaded: 8,
            categories_changed: 8,
            categories_retired: 0,
            category_links_added: 122,
            category_links_removed: 0,
            translations_loaded: 0,
            translations_not_yet: 0,
          },
          warnings: 2436,
          failures: 0,
        },
      });
      expect(runs[1].meta).toMatchObject({ counts: { providers_loaded: 99, providers_changed: 0, locations_changed: 0, categories_changed: 0, category_links_added: 0, category_links_removed: 0 } });
    });

    it("loads nothing when the file fails its schema, lists every failing entry and audits the refusal", async () => {
      await seed(input([entry("M001"), entry("M002")]));
      const before = await everything();
      const bad = input([
        entry("M001", { name: "Changed but refused" }),
        entry("M003", { id: undefined }),
        entry("M004", { location: { lat: 50, lng: -79.3 } }),
        entry("M005", { categories: ["Spaceships"] }),
        entry("M006"),
        entry("M006"),
      ]);

      const attempt = seed(bad);

      await expect(attempt).rejects.toBeInstanceOf(ProviderSeedRefusedError);
      await expect(attempt).rejects.toMatchObject({
        failures: [
          "providers[1]: id: is missing",
          "providers[2] (M004): location.lat: is outside Toronto (43.58 to 43.86)",
          'providers[3] (M005): category "Spaceships" is not in labels.categories',
          "providers[4] (M006): id M006 is used 2 times (providers[4], providers[5])",
          "providers[5] (M006): id M006 is used 2 times (providers[4], providers[5])",
        ],
      });
      expect(await everything()).toEqual(before);
      const runs = await seedRuns();
      expect(runs.at(-1)).toEqual({ outcome: "refused", meta: { seed: "provider_catalogue", failures: 5 } });
    });

    it("unpublishes and flags a provider that left the catalogue, never deletes it, and keeps its last-confirmed date", async () => {
      await seed(input([entry("M001"), entry("M002"), entry("M003", { categories: ["Health & Wellness", "Non-Profits"] })]));
      for (const id of ["M001", "M002", "M003"]) {
        expect(await confirmProvider(app, staffId, id, "2026-09-15", { now: NOW })).toMatchObject({ ok: true });
        expect(await publishProvider(app, staffId, id, { now: NOW })).toMatchObject({ ok: true });
      }

      const result = await seed(input([entry("M001"), entry("M003", { categories: ["Health & Wellness", "Non-Profits"] })]));

      expect(result.removed).toEqual({ flagged: 1, unpublished: 1 });
      const gone = await row("M002");
      expect(gone).toMatchObject({ in_catalogue: false, published: false, published_at: null, last_confirmed: "2026-09-15" });
      // The others are untouched: still in the catalogue, published and confirmed.
      expect(await row("M001")).toMatchObject({ in_catalogue: true, published: true });
      expect((await row("M003")).last_confirmed).toBe("2026-09-15");
      // Its location and categories stay with it.
      expect((await sql.unsafe("select count(*)::int as n from provider_location where provider_id = 'M002'"))[0].n).toBe(1);
      expect((await sql.unsafe("select count(*)::int as n from provider_category where provider_id = 'M002'"))[0].n).toBe(1);
      expect((await sql.unsafe("select count(*)::int as n from provider"))[0].n).toBe(3);
      expect((await seedRuns()).at(-1)?.meta).toMatchObject({ counts: { providers_not_in_catalogue: 1, providers_unpublished: 1 } });
    });

    it("does not unpublish or flag again on the next run, and a provider that comes back is in the catalogue but still unpublished", async () => {
      await seed(input([entry("M001"), entry("M002")]));
      await confirmProvider(app, staffId, "M002", "2026-09-15", { now: NOW });
      await publishProvider(app, staffId, "M002", { now: NOW });
      await seed(input([entry("M001")]));
      const afterRemoval = await row("M002");

      const again = await seed(input([entry("M001")]));
      expect(again.removed).toEqual({ flagged: 0, unpublished: 0 });
      expect(again.changed.providers).toBe(0);
      expect(await row("M002")).toEqual(afterRemoval);

      const back = await seed(input([entry("M001"), entry("M002")]));
      expect(back.changed.providers).toBe(1);
      expect(await row("M002")).toMatchObject({ in_catalogue: true, published: false, last_confirmed: "2026-09-15" });
    });

    it("leaves the Admins' published and last-confirmed alone when the listing text changes", async () => {
      await seed(input([entry("M001")]));
      await confirmProvider(app, staffId, "M001", "2026-09-20", { now: NOW });
      await publishProvider(app, staffId, "M001", { now: NOW });
      const published = await row("M001");

      const result = await seed(input([entry("M001", { name: "A new name", services: { id: "x", en: "New services text" }, lastConfirmed: "2020-01-01" })]));

      expect(result.changed.providers).toBe(1);
      const after = await row("M001");
      expect(after).toMatchObject({ name: "A new name", published: true, last_confirmed: "2026-09-20", texts: { services: { en: "New services text" } } });
      expect(after.published_at).toEqual(published.published_at);
    });

    it("updates only what changed: a new address changes the location, a new category the links", async () => {
      await seed(input([entry("M001"), entry("M002")]));

      const result = await seed(
        input([entry("M001", { address: { street: "9 New St", city: "East York", postal: null }, categories: ["Non-Profits"] }), entry("M002")]),
      );

      expect(result.changed).toEqual({ providers: 0, locations: 1, categories: 0, categoryLinks: 2 });
      expect((await sql.unsafe("select street, postal from provider_location where provider_id = 'M001'"))[0]).toMatchObject({ street: "9 New St", postal: null });
      expect((await sql.unsafe("select c.name from provider_category pc join category c on c.id = pc.category_id where pc.provider_id = 'M001'")).map((r) => r.name)).toEqual(["Non-Profits"]);
    });

    it("loads a translation only when it is reviewed and current", async () => {
      const english = "Services of M001";
      const reviewedRecord = (change: Record<string, unknown> = {}) => ({
        source: english,
        text: "خدمات",
        model: "command-a-translate-08-2025",
        status: "reviewed",
        reviewer: "Wei Chen",
        reviewedOn: "2026-11-02",
        ...change,
      });
      const withRecord = (value: unknown) => input([entry("M001")], { ur: { texts: { [catalogueTextId(english)]: value as never } } });

      await seed(withRecord(reviewedRecord()));
      expect((await row("M001")).texts.services).toEqual({ en: english, ur: "خدمات" });
      expect((await row("M001")).translations.services.ur).toMatchObject({ status: "reviewed", reviewer: "Wei Chen" });

      // Review withdrawn (machine again): the next run takes the translation out.
      const result = await seed(withRecord(reviewedRecord({ status: "machine", reviewer: null, reviewedOn: null })));
      expect(result.changed.providers).toBe(1);
      expect((await row("M001")).texts.services).toEqual({ en: english });

      // The English changed since it was translated: stale, not loaded.
      await seed(withRecord(reviewedRecord({ source: "Older services text" })));
      expect((await row("M001")).texts.services).toEqual({ en: english });
    });
  });

  describe("an Admin's changes, as the app's own role", () => {
    beforeEach(async () => {
      await seed(input([entry("M001"), entry("M002", { categories: ["Health & Wellness", "Non-Profits"] })]));
    });

    it("refuses to publish a provider with no last-confirmed date: 'confirm first', nothing changes, the refusal is audited", async () => {
      const before = await row("M001");

      const result = await publishProvider(app, staffId, "M001", { now: NOW });

      expect(result).toEqual({ ok: false, error: "confirm_first" });
      expect(await row("M001")).toEqual(before);
      expect(await auditOf("provider.published")).toEqual([
        { actor_staff_id: staffId, subject_type: "provider", subject_id: "M001", outcome: "refused", meta: { reason: "validation" } },
      ]);
    });

    it("sets the last-confirmed date (today or earlier), then publishes, then unpublishes with the date kept", async () => {
      expect(await confirmProvider(app, staffId, "M001", TODAY, { now: NOW })).toEqual({ ok: true, name: "Provider M001", lastConfirmed: TODAY });
      expect(await row("M001")).toMatchObject({ last_confirmed: TODAY, published: false });

      expect(await publishProvider(app, staffId, "M001", { now: NOW })).toMatchObject({ ok: true });
      const published = await row("M001");
      expect(published).toMatchObject({ published: true, last_confirmed: TODAY });
      expect(published.published_at).toEqual(NOW());

      expect(await unpublishProvider(app, staffId, "M001", { now: NOW })).toMatchObject({ ok: true });
      expect(await row("M001")).toMatchObject({ published: false, published_at: null, last_confirmed: TODAY });

      expect(await auditOf("provider.confirmed")).toEqual([
        { actor_staff_id: staffId, subject_type: "provider", subject_id: "M001", outcome: "ok", meta: { confirmed_on: TODAY, previous: null } },
      ]);
      expect(await auditOf("provider.published")).toEqual([
        { actor_staff_id: staffId, subject_type: "provider", subject_id: "M001", outcome: "ok", meta: { last_confirmed: TODAY } },
      ]);
      expect(await auditOf("provider.unpublished")).toEqual([
        { actor_staff_id: staffId, subject_type: "provider", subject_id: "M001", outcome: "ok", meta: {} },
      ]);
    });

    it("records the previous date when a date is set again, and accepts an earlier date than the one before", async () => {
      await confirmProvider(app, staffId, "M001", "2026-09-30", { now: NOW });
      await confirmProvider(app, staffId, "M001", "2026-09-01", { now: NOW });

      expect((await auditOf("provider.confirmed")).map((e) => e.meta)).toEqual([
        { confirmed_on: "2026-09-30", previous: null },
        { confirmed_on: "2026-09-01", previous: "2026-09-30" },
      ]);
      expect((await row("M001")).last_confirmed).toBe("2026-09-01");
    });

    it.each([
      ["a date after today", "2026-10-03", "date_in_future"],
      ["a date far in the future", "2030-01-01", "date_in_future"],
      ["an impossible date", "2026-02-30", "date_invalid"],
      ["no date", "", "date_invalid"],
      ["words", "yesterday", "date_invalid"],
    ])("refuses %s and leaves the date as it was", async (_, date, error) => {
      await confirmProvider(app, staffId, "M001", "2026-09-30", { now: NOW });

      expect(await confirmProvider(app, staffId, "M001", date, { now: NOW })).toEqual({ ok: false, error });

      expect((await row("M001")).last_confirmed).toBe("2026-09-30");
      expect((await auditOf("provider.confirmed")).at(-1)).toMatchObject({ outcome: "refused", meta: { reason: "validation" } });
    });

    it("uses the date in Toronto for 'today': the evening of the 2nd is still the 2nd", async () => {
      const lateEvening = () => new Date("2026-10-03T02:30:00Z"); // 22:30 on 2026-10-02 in Toronto

      expect(await confirmProvider(app, staffId, "M001", "2026-10-02", { now: lateEvening })).toMatchObject({ ok: true });
      expect(await confirmProvider(app, staffId, "M001", "2026-10-03", { now: lateEvening })).toEqual({ ok: false, error: "date_in_future" });
    });

    it("refuses a repeat publish or unpublish, and an unknown provider, with the reason audited", async () => {
      await confirmProvider(app, staffId, "M001", TODAY, { now: NOW });
      await publishProvider(app, staffId, "M001", { now: NOW });

      expect(await publishProvider(app, staffId, "M001", { now: NOW })).toEqual({ ok: false, error: "already_published" });
      expect(await unpublishProvider(app, staffId, "M002", { now: NOW })).toEqual({ ok: false, error: "not_published" });
      expect(await publishProvider(app, staffId, "M999", { now: NOW })).toEqual({ ok: false, error: "not_found" });
      expect(await publishProvider(app, staffId, "not an id!", { now: NOW })).toEqual({ ok: false, error: "not_found" });

      expect((await auditOf("provider.published")).map((e) => [e.subject_id, e.outcome, e.meta])).toEqual([
        ["M001", "ok", { last_confirmed: TODAY }],
        ["M001", "refused", { reason: "conflict" }],
        ["M999", "refused", { reason: "not_found" }],
        [null, "refused", { reason: "not_found" }],
      ]);
    });

    it("refuses to publish or confirm a provider that left the catalogue", async () => {
      await confirmProvider(app, staffId, "M002", TODAY, { now: NOW });
      await seed(input([entry("M001")]));

      expect(await publishProvider(app, staffId, "M002", { now: NOW })).toEqual({ ok: false, error: "not_in_catalogue" });
      expect(await confirmProvider(app, staffId, "M002", "2026-10-01", { now: NOW })).toEqual({ ok: false, error: "not_in_catalogue" });
      expect(await row("M002")).toMatchObject({ published: false, last_confirmed: TODAY, in_catalogue: false });
    });

    it("rolls the change back when its audit record cannot be written", async () => {
      await confirmProvider(app, staffId, "M001", TODAY, { now: NOW });
      const before = await row("M001");
      audit.mockRejectedValueOnce(new Error("audit store down"));

      await expect(publishProvider(app, staffId, "M001", { now: NOW })).rejects.toThrow("audit store down");

      expect(await row("M001")).toEqual(before);
      expect(await auditOf("provider.published")).toEqual([]);
    });

    it("lets one of two simultaneous publishes through, with one audit record", async () => {
      await confirmProvider(app, staffId, "M001", TODAY, { now: NOW });

      const results = await Promise.all([publishProvider(app, staffId, "M001", { now: NOW }), publishProvider(app, staffId, "M001", { now: NOW })]);

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "already_published" }]);
      expect((await auditOf("provider.published")).filter((e) => e.outcome === "ok")).toHaveLength(1);
    });

    describe("a publish at the same time as the seed removing the provider", () => {
      // A second connection holds the provider's row lock while the two competing transactions queue behind
      // it in a known order; releasing it lets the first in line go first.
      async function race<A, B>(first: "publish" | "seed", publish: () => Promise<A>, remove: () => Promise<B>) {
        const holder = connect(serverUrl());
        const probe = connect(serverUrl());
        let release!: () => void;
        const released = new Promise<void>((resolve) => (release = resolve));
        let locked!: () => void;
        const hasLock = new Promise<void>((resolve) => (locked = resolve));
        const holding = holder.begin(async (tx) => {
          await tx`select id from provider where id = 'M001' for update`;
          locked();
          await released;
        });
        const waiters = async (n: number) => {
          for (let i = 0; i < 200; i += 1) {
            const [{ count }] = await probe`select count(*)::int as count from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`;
            if (count >= n) return;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          throw new Error("the competing transactions never queued on the row lock");
        };
        try {
          await hasLock;
          let publishing: Promise<A>;
          let removing: Promise<B>;
          if (first === "publish") {
            publishing = publish();
            await waiters(1);
            removing = remove();
          } else {
            removing = remove();
            await waiters(1);
            publishing = publish();
          }
          await waiters(2);
          release();
          await holding;
          return { publish: await publishing, seeded: await removing };
        } finally {
          release();
          await holding.catch(() => undefined);
          await holder.end({ timeout: 5 });
          await probe.end({ timeout: 5 });
        }
      }
      const run = (first: "publish" | "seed") =>
        race(first, () => publishProvider(app, staffId, "M001", { now: NOW }), () => seed(input([entry("M002", { categories: ["Health & Wellness", "Non-Profits"] })])));

      beforeEach(async () => {
        await confirmProvider(app, staffId, "M001", TODAY, { now: NOW });
        await confirmProvider(app, staffId, "M002", TODAY, { now: NOW });
      });

      it("publish first: the seed then unpublishes it, so the end state is flagged and unpublished, with both audited", async () => {
        const { publish, seeded } = await run("publish");

        expect(publish).toMatchObject({ ok: true });
        expect(seeded.removed).toEqual({ flagged: 1, unpublished: 1 });
        expect(await row("M001")).toMatchObject({ in_catalogue: false, published: false, published_at: null, last_confirmed: TODAY });
        expect((await auditOf("provider.published")).map((e) => [e.subject_id, e.outcome])).toEqual([["M001", "ok"]]);
        expect((await seedRuns()).at(-1)?.meta).toMatchObject({ counts: { providers_not_in_catalogue: 1, providers_unpublished: 1 } });
      });

      it("seed first: the publish is refused as not in the catalogue, the refusal is audited, and nothing is published", async () => {
        const { publish, seeded } = await run("seed");

        expect(seeded.removed).toEqual({ flagged: 1, unpublished: 0 });
        expect(publish).toEqual({ ok: false, error: "not_in_catalogue" });
        expect(await row("M001")).toMatchObject({ in_catalogue: false, published: false, published_at: null, last_confirmed: TODAY });
        expect((await auditOf("provider.published")).map((e) => [e.subject_id, e.outcome, e.meta])).toEqual([["M001", "refused", { reason: "conflict" }]]);
      });
    });

    it("lists the providers with their categories, state and street", async () => {
      await confirmProvider(app, staffId, "M002", TODAY, { now: NOW });
      await publishProvider(app, staffId, "M002", { now: NOW });
      await seed(input([entry("M002", { categories: ["Health & Wellness", "Non-Profits"] }), entry("M003")]));

      const list = await listProviders(app);

      expect(list).toEqual([
        { id: "M002", name: "Provider M002", categories: ["Health & Wellness", "Non-Profits"], street: "M002 Overlea Blvd", published: true, inCatalogue: true, lastConfirmed: TODAY },
        { id: "M003", name: "Provider M003", categories: ["Health & Wellness"], street: "M003 Overlea Blvd", published: false, inCatalogue: true, lastConfirmed: null },
        { id: "M001", name: "Provider M001", categories: ["Health & Wellness"], street: "M001 Overlea Blvd", published: false, inCatalogue: false, lastConfirmed: null },
      ]);
    });
  });

  describe("what the app's role can do to the tables", () => {
    beforeEach(async () => {
      await seed(input([entry("M001")]));
    });

    it("reads them", async () => {
      const rows = await appSql.unsafe("select (select count(*)::int from provider) as providers, (select count(*)::int from category) as categories, (select count(*)::int from provider_location) as locations, (select count(*)::int from provider_category) as links");
      expect({ ...rows[0] }).toEqual({ providers: 1, categories: 2, locations: 1, links: 1 });
    });

    it.each([
      ["edit a provider's name", "update provider set name = 'Changed'"],
      ["edit a provider's listing text", `update provider set texts = '{"services": {"en": "Changed"}}'`],
      ["edit a provider's contact details", `update provider set contact = '{}'`],
      ["flag a provider as in the catalogue", "update provider set in_catalogue = true"],
      ["insert a provider", "insert into provider (id, name, texts) values ('M777', 'X', '{}')"],
      ["delete a provider", "delete from provider"],
      ["edit a location", "update provider_location set street = 'Changed'"],
      ["delete a location", "delete from provider_location"],
      ["edit a category", "update category set name = 'Changed'"],
      ["insert a category", "insert into category (id, name, sort_order, labels) values ('x', 'X', 9, '{}')"],
      ["link a provider to a category", "insert into provider_category (provider_id, category_id) select 'M001', id from category limit 1 on conflict do nothing"],
      ["delete a link", "delete from provider_category"],
    ])("cannot %s", async (_, statement) => {
      const before = await everything();

      await expect(appSql.unsafe(statement)).rejects.toThrow(/permission denied/);

      expect(await everything()).toEqual(before);
    });

    it("can change only the publication columns, and the database still refuses a publish with no date", async () => {
      await expect(appSql.unsafe("update provider set published = true, published_at = now() where id = 'M001'")).rejects.toThrow(/provider_published_after_confirmation/);
      await expect(appSql.unsafe("update provider set last_confirmed = '2026-10-01' where id = 'M001'")).resolves.toBeDefined();
    });
  });
});
