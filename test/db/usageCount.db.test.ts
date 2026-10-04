// Usage counts against a real database (S02.15, AR-26, FR-M1, FR-M3): the daily count of each event by language and neighbourhood, and the
// proof that nothing in it can be tied to a person: the table has no column that could hold an identifier or a time, two phones making the same
// event leave one indistinguishable row, and the app role can only add rows and raise the count.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { metricsResponse } from "../../src/app/api/metrics/handler";
import { migrate } from "../../scripts/db/migrate.mjs";
import { USAGE_EVENTS } from "@/contracts/usage";
import { recordUsage } from "@/modules/directory";
import { createDb, type Db } from "@/platform/db";
import { connect, serverUrl } from "./helpers";

type Row = { day: string; evt: string; lang: string; nbhd: string; n: number };

describe("usage_count (S02.15)", () => {
  let sql: ReturnType<typeof connect>;
  let appSql: ReturnType<typeof connect>;
  let app: Db;
  const rows = async (): Promise<Row[]> =>
    (await sql`select day::text as day, evt, lang, nbhd, n::int as n from usage_count order by day, evt, lang, nbhd`) as unknown as Row[];

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
    await sql`delete from usage_count`;
    await sql.unsafe("alter role cvh_app_login password null");
    await appSql.end({ timeout: 5 });
    await app.$client.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`delete from usage_count`;
  });

  it("adds a row for the first event of the day and raises its count after that, one row for each day, event, language and neighbourhood", async () => {
    const noon = new Date("2026-10-05T16:00:00Z");

    await recordUsage(app, { evt: "directory_view", lang: "ur" }, noon);
    await recordUsage(app, { evt: "directory_view", lang: "ur" }, noon);
    await recordUsage(app, { evt: "directory_view", lang: "ur" }, new Date("2026-10-05T20:59:00Z"));
    await recordUsage(app, { evt: "directory_view", lang: "ur", nbhd: "TP" }, noon);
    await recordUsage(app, { evt: "directory_view", lang: "en" }, noon);
    await recordUsage(app, { evt: "map_view", lang: "ur" }, noon);
    await recordUsage(app, { evt: "directory_view", lang: "ur" }, new Date("2026-10-06T16:00:00Z"));

    expect(await rows()).toEqual([
      { day: "2026-10-05", evt: "directory_view", lang: "en", nbhd: "", n: 1 },
      { day: "2026-10-05", evt: "directory_view", lang: "ur", nbhd: "", n: 3 },
      { day: "2026-10-05", evt: "directory_view", lang: "ur", nbhd: "TP", n: 1 },
      { day: "2026-10-05", evt: "map_view", lang: "ur", nbhd: "", n: 1 },
      { day: "2026-10-06", evt: "directory_view", lang: "ur", nbhd: "", n: 1 },
    ]);
  });

  it("counts every event in every language, and events that arrive at the same moment are all counted", async () => {
    const at = new Date("2026-10-05T16:00:00Z");

    await Promise.all(Array.from({ length: 25 }, () => recordUsage(app, { evt: "install", lang: "en", nbhd: "FP" }, at)));
    for (const evt of USAGE_EVENTS) await recordUsage(app, { evt, lang: "zh-Hant" }, at);

    const all = await rows();
    expect(all.find((r) => r.evt === "install" && r.lang === "en")?.n).toBe(25);
    expect(all.filter((r) => r.lang === "zh-Hant").map((r) => r.evt).sort()).toEqual([...USAGE_EVENTS].sort());
  });

  it("counts by the Toronto day: late evening there is still that day, though it is the next day in UTC", async () => {
    await recordUsage(app, { evt: "guide_view", lang: "en" }, new Date("2026-10-06T03:30:00Z"));
    await recordUsage(app, { evt: "guide_view", lang: "en" }, new Date("2026-10-06T04:30:00Z"));
    // Winter time: the day turns at 05:00 UTC.
    await recordUsage(app, { evt: "guide_view", lang: "en" }, new Date("2026-12-10T04:59:00Z"));
    await recordUsage(app, { evt: "guide_view", lang: "en" }, new Date("2026-12-10T05:00:00Z"));

    expect((await rows()).map((r) => `${r.day}:${r.n}`)).toEqual(["2026-10-05:1", "2026-10-06:1", "2026-12-09:1", "2026-12-10:1"]);
  });

  it("has only the day, the event, the language, the neighbourhood and the count: no time, no identifier, no address, nothing a person could be found by", async () => {
    const columns = await sql`
      select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'usage_count' order by ordinal_position`;

    expect(columns.map((c) => `${c.column_name}:${c.data_type}`)).toEqual(["day:date", "evt:text", "lang:text", "nbhd:text", "n:bigint"]);
    // No trigger, rule or generated column writes anything else, and nothing points at or from another table.
    expect(await sql`select tgname from pg_trigger where tgrelid = 'usage_count'::regclass and not tgisinternal`).toEqual([]);
    expect(await sql`select conname from pg_constraint where conrelid = 'usage_count'::regclass and contype = 'f'`).toEqual([]);
    expect(await sql`select confrelid::regclass::text as t from pg_constraint where confrelid = 'usage_count'::regclass`).toEqual([]);
    // The only key is the combination counted: a row is the same for every phone that did the same.
    const key = await sql`
      select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
      where i.indrelid = 'usage_count'::regclass and i.indisprimary order by a.attnum`;
    expect(key.map((k) => k.attname)).toEqual(["day", "evt", "lang", "nbhd"]);
  });

  it("through the route: two phones with different addresses, agents and cookies leave one row, and none of what they sent is anywhere in the table", async () => {
    const send = (headers: Record<string, string>, body: object = { evt: "numbers_view", lang: "tl" }) =>
      metricsResponse({ count: (event) => recordUsage(app, event, new Date("2026-10-05T16:00:00Z")) }, new Request("https://cvh.example/api/metrics", { method: "POST", body: JSON.stringify(body), headers }));

    const first = await send({ "x-forwarded-for": "198.51.100.23", "user-agent": "PhoneOne/1.0", cookie: "sid=aaa111", referer: "https://cvh.example/en/buildings/55555" });
    const second = await send({ "x-forwarded-for": "203.0.113.77", "user-agent": "PhoneTwo/9.9", cookie: "sid=bbb222" });

    expect([first.status, second.status]).toEqual([204, 204]);
    expect(await rows()).toEqual([{ day: "2026-10-05", evt: "numbers_view", lang: "tl", nbhd: "", n: 2 }]);
    const [{ dump }] = await sql`select string_agg(t::text, ' ') as dump from usage_count t`;
    expect(dump).not.toMatch(/198\.51|203\.0\.113|PhoneOne|PhoneTwo|aaa111|bbb222|55555/);
    // Refused events leave nothing.
    expect((await send({}, { evt: "numbers_view", lang: "tl", rsn: "55555" })).status).toBe(400);
    expect((await rows())[0].n).toBe(2);
  });

  it("lets the app add rows and raise the count, and nothing else; nobody else touches it", async () => {
    const privilege = async (role: string, what: string) => (await sql.unsafe(`select has_table_privilege('${role}', 'usage_count', '${what}') as yes`))[0].yes;
    const column = async (role: string, name: string) => (await sql.unsafe(`select has_column_privilege('${role}', 'usage_count', '${name}', 'update') as yes`))[0].yes;

    expect([await privilege("cvh_app", "select"), await privilege("cvh_app", "insert")]).toEqual([true, true]);
    expect([await privilege("cvh_app", "delete"), await privilege("cvh_app", "truncate")]).toEqual([false, false]);
    expect([await column("cvh_app", "n"), await column("cvh_app", "day"), await column("cvh_app", "evt"), await column("cvh_app", "lang"), await column("cvh_app", "nbhd")]).toEqual([true, false, false, false, false]);
    for (const role of ["anon", "authenticated", "service_role", "public"]) {
      for (const what of ["select", "insert", "update", "delete"]) expect(await privilege(role, what), `${role} ${what}`).toBe(false);
    }
    expect((await sql`select relrowsecurity from pg_class where oid = 'usage_count'::regclass`)[0].relrowsecurity).toBe(true);
    await expect(appSql`delete from usage_count`).rejects.toThrow(/permission denied/);
    await expect(appSql`update usage_count set lang = 'fr'`).rejects.toThrow(/permission denied/);
  });

  it("refuses a row the app should never write: an unknown event, a bad language or neighbourhood, an empty count", async () => {
    const insert = (evt: string, lang: string, nbhd: string, n: number) =>
      appSql`insert into usage_count (day, evt, lang, nbhd, n) values ('2026-10-05', ${evt}, ${lang}, ${nbhd}, ${n})`;

    await expect(insert("pageview", "en", "", 1)).rejects.toThrow(/usage_count_evt/);
    await expect(insert("install", "english", "", 1)).rejects.toThrow(/usage_count_lang_format/);
    await expect(insert("install", "en", "Thorncliffe", 1)).rejects.toThrow(/usage_count_nbhd/);
    await expect(insert("install", "en", "", 0)).rejects.toThrow(/usage_count_n_positive/);
    expect(await rows()).toEqual([]);
  });
});
