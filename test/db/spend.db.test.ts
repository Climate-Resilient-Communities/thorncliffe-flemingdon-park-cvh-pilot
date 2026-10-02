// spend_event against a real database (S03.02): what the app's role may do with it, what it refuses to hold, and how the
// month's usage is counted (the calendar month in America/Toronto).
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { monthlyUsage, recordSpendEvent } from "@/modules/spend";
import { createDb, type Db } from "@/platform/db";
import { connect, serverUrl } from "./helpers";

describe("spend_event (S03.02)", () => {
  let sql: ReturnType<typeof connect>;
  let appSql: ReturnType<typeof connect>;
  let app: Db;

  beforeAll(async () => {
    sql = connect(serverUrl());
    await migrate({ sql });
    const password = randomBytes(18).toString("hex");
    await sql.unsafe(`alter role cvh_app_login password '${password}'`);
    const url = new URL(serverUrl());
    url.username = "cvh_app_login";
    url.password = password;
    app = createDb(url.href);
    appSql = connect(url.href);
  });

  afterAll(async () => {
    await sql.unsafe("delete from spend_event");
    await sql.unsafe("alter role cvh_app_login password null");
    await appSql.end({ timeout: 5 });
    await app.$client.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql.unsafe("delete from spend_event");
  });

  const embed = { kind: "embed", purpose: "publish", model: "embed-v4.0", releaseV: 3, tokens: 1500, ms: 420 } as const;

  it("takes an event as the app's role, with the price left null", async () => {
    await recordSpendEvent(app, embed);

    const rows = await sql`select kind, purpose, model, release_v, calls, tokens, tokens_estimated, ms, price_per_million_tokens_cad from spend_event`;
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { kind: "embed", purpose: "publish", model: "embed-v4.0", release_v: 3, calls: 1, tokens: "1500", tokens_estimated: false, ms: 420, price_per_million_tokens_cad: null },
    ]);
  });

  it("records a price when the vendor's is known", async () => {
    await recordSpendEvent(app, { ...embed, pricePerMillionTokensCad: 0.14 });

    expect((await sql`select price_per_million_tokens_cad as price from spend_event`)[0].price).toBe("0.14");
  });

  it("rolls back with the caller's transaction when it is written inside one", async () => {
    await app
      .transaction(async (tx) => {
        await recordSpendEvent(tx, embed);
        throw new Error("rolled back");
      })
      .catch(() => undefined);

    expect(await sql`select 1 from spend_event`).toHaveLength(0);
  });

  it("is append-only for the app: it reads and inserts, and cannot change or delete a row", async () => {
    await recordSpendEvent(app, embed);

    expect(await appSql`select count(*)::int as n from spend_event`).toEqual([{ n: 1 }]);
    await expect(appSql.unsafe("update spend_event set tokens = 0")).rejects.toThrow(/permission denied/);
    await expect(appSql.unsafe("delete from spend_event")).rejects.toThrow(/permission denied/);
    await expect(appSql.unsafe("truncate spend_event")).rejects.toThrow(/permission denied/);
  });

  it("has row level security and nothing for the client roles, its table or its sequence", async () => {
    expect((await sql`select relrowsecurity as rls from pg_class where relname = 'spend_event'`)[0].rls).toBe(true);
    const clients = await sql.unsafe(
      `select r.rolname from pg_roles r, pg_class c
       where r.rolname in ('anon', 'authenticated', 'service_role') and c.relname = 'spend_event'
         and has_table_privilege(r.oid, c.oid, 'select, insert, update, delete, truncate, references, trigger')`,
    );
    expect(clients).toEqual([]);
    const sequences = await sql.unsafe(
      "select r.rolname from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') and has_sequence_privilege(r.oid, 'spend_event_id_seq', 'usage, select, update')",
    );
    expect(sequences).toEqual([]);
  });

  it.each([
    ["a kind that is not a code", "insert into spend_event (kind, purpose, model) values ('Embed Call', 'publish', 'm')"],
    ["a model with spaces", "insert into spend_event (kind, purpose, model) values ('embed', 'publish', 'a question typed by a resident')"],
    ["no calls", "insert into spend_event (kind, purpose, model, calls) values ('embed', 'publish', 'm', 0)"],
    ["negative tokens", "insert into spend_event (kind, purpose, model, tokens) values ('embed', 'publish', 'm', -1)"],
    ["a negative price", "insert into spend_event (kind, purpose, model, price_per_million_tokens_cad) values ('embed', 'publish', 'm', -1)"],
    ["a release number of zero", "insert into spend_event (kind, purpose, model, release_v) values ('embed', 'publish', 'm', 0)"],
  ])("refuses %s, even from the owner", async (_name, statement) => {
    await expect(sql.unsafe(statement)).rejects.toThrow(/violates check constraint/);
  });

  describe("the month's usage", () => {
    const at = (iso: string, calls: number, tokens: number, kind = "embed") =>
      sql`insert into spend_event (at, kind, purpose, model, calls, tokens) values (${new Date(iso)}, ${kind}, 'publish', 'embed-v4.0', ${calls}, ${tokens})`;

    it("is zero before anything is recorded", async () => {
      expect(await monthlyUsage(app, "embed", new Date("2026-10-02T15:00:00Z"))).toEqual({ calls: 0, tokens: 0 });
    });

    it("adds the calls and tokens of the calendar month, whoever made them, and nothing of another kind", async () => {
      await at("2026-10-01T05:00:00Z", 2, 1000);
      await at("2026-10-15T12:00:00Z", 1, 250);
      await at("2026-10-15T12:00:00Z", 7, 7000, "translate");
      await sql`insert into spend_event (at, kind, purpose, model, calls, tokens) values (${new Date("2026-10-20T12:00:00Z")}, 'embed', 'test_set', 'embed-v4.0', 4, 80)`;

      expect(await monthlyUsage(app, "embed", new Date("2026-10-21T00:00:00Z"))).toEqual({ calls: 7, tokens: 1330 });
    });

    it("starts the month at midnight in Toronto, not in UTC", async () => {
      // 2026-10-01 03:59 UTC is 23:59 on September 30th in Toronto (EDT); 04:00 UTC is October 1st, 00:00.
      await at("2026-10-01T03:59:00Z", 5, 500);
      await at("2026-10-01T04:00:00Z", 1, 100);

      expect(await monthlyUsage(app, "embed", new Date("2026-10-02T15:00:00Z"))).toEqual({ calls: 1, tokens: 100 });
      expect(await monthlyUsage(app, "embed", new Date("2026-09-30T20:00:00Z"))).toEqual({ calls: 5, tokens: 500 });
    });

    it("follows the clock change: December starts at 05:00 UTC, in standard time", async () => {
      await at("2026-12-01T04:59:00Z", 3, 30);
      await at("2026-12-01T05:00:00Z", 1, 10);

      expect(await monthlyUsage(app, "embed", new Date("2026-12-10T12:00:00Z"))).toEqual({ calls: 1, tokens: 10 });
    });

    it("reads inside a caller's transaction through the transaction", async () => {
      await at("2026-10-05T12:00:00Z", 2, 20);

      const usage = await app.transaction(async (tx) => monthlyUsage(tx, "embed", new Date("2026-10-06T00:00:00Z")));

      expect(usage).toEqual({ calls: 2, tokens: 20 });
    });
  });
});
