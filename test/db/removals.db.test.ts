// What the database snapshot (scripts/db/removals.mjs) reports for a migration:
// everything that can break the release that is still running while it applies.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { createFreshDatabase, migrationsDir, type FreshDatabase } from "./helpers";

// The app role exists before the schema, as it does in production (migration 20261002010000).
const BASE = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'cvh_app') then create role cvh_app nologin noinherit; end if;
  end $$;
  grant usage on schema public to cvh_app;
  create type mood as enum ('ok', 'bad');
  create table staff (id int primary key);
  create table note (
    id int primary key,
    body text,
    mood mood,
    kind text default 'plain',
    owner_id int
  );
  alter table note enable row level security;
  create policy note_read on note for select to cvh_app using (true);
  grant select, insert on table note to cvh_app;
  create view note_feed as select id, body from note;
  grant select on note_feed to cvh_app;
  create function note_count() returns bigint language sql stable as $$ select count(*) from note $$;
  grant execute on function note_count() to cvh_app;
  create sequence note_seq;
  grant usage on sequence note_seq to cvh_app;
`;

describe("database snapshot of a migration", () => {
  let db: FreshDatabase;
  let files: ReturnType<typeof migrationsDir>;

  beforeEach(async () => {
    db = await createFreshDatabase();
    files = migrationsDir({});
    files.write("20260101000001_base.sql", BASE);
  });

  afterEach(async () => {
    files.remove();
    await db.drop();
  });

  async function changesBy(sql: string): Promise<string[]> {
    files.write("20260101000002_change.sql", sql);
    const { removals } = await migrate({ sql: db.sql, dir: files.dir, recordRemovals: true });
    expect(removals["20260101000001_base.sql"]).toEqual([]);
    return removals["20260101000002_change.sql"];
  }

  it.each([
    ["set not null on a column", "alter table note alter column body set not null;", "makes column public.note.body not null"],
    [
      "a not null column without a default",
      "alter table note add column flag boolean not null;",
      "adds column public.note.flag as not null without a default",
    ],
    ["a dropped default", "alter table note alter column kind drop default;", "drops the default of column public.note.kind"],
    ["a changed default", "alter table note alter column kind set default 'other';", "changes the default of column public.note.kind"],
    [
      "a check constraint",
      "alter table note add constraint body_short check (length(body) < 100);",
      "adds constraint body_short on public.note: CHECK ((length(body) < 100))",
    ],
    [
      "a foreign key",
      "alter table note add constraint owner_fk foreign key (owner_id) references staff (id);",
      "adds constraint owner_fk on public.note: FOREIGN KEY (owner_id) REFERENCES staff(id)",
    ],
    ["a unique constraint", "alter table note add constraint body_key unique (body);", "adds constraint body_key on public.note: UNIQUE (body)"],
    [
      "a changed check constraint",
      "alter table note add constraint c check (id > 0); alter table note drop constraint c; alter table note add constraint c check (id > 5);",
      "adds constraint c on public.note: CHECK ((id > 5))",
    ],
    ["a dropped view", "drop view note_feed;", "removes view public.note_feed (dropped, renamed or moved)"],
    ["a renamed view", "alter view note_feed rename to feed;", "removes view public.note_feed (dropped, renamed or moved)"],
    [
      "a changed view definition",
      "create or replace view note_feed as select id, body from note where body is not null;",
      "changes the definition of view public.note_feed",
    ],
    ["a dropped function", "drop function note_count();", "removes function public.note_count() (dropped, renamed or its signature changed)"],
    [
      "a function with a changed signature",
      "alter function note_count() rename to note_total;",
      "removes function public.note_count() (dropped, renamed or its signature changed)",
    ],
    [
      "a function that now returns another type",
      "drop function note_count(); create function note_count() returns int language sql stable as $$ select 1 $$; grant execute on function note_count() to cvh_app;",
      'changes the result or security of function public.note_count() from "bigint" to "integer"',
    ],
    [
      "a function made security definer",
      "alter function note_count() security definer;",
      'changes the result or security of function public.note_count() from "bigint" to "bigint security definer"',
    ],
    ["a dropped policy", "drop policy note_read on note;", "removes policy note_read on public.note (dropped or renamed)"],
    ["a changed policy", "alter policy note_read on note using (body is not null);", "changes policy note_read on public.note"],
    [
      "a restrictive policy",
      "create policy note_limit on note as restrictive for select to cvh_app using (id > 0);",
      "adds restrictive policy note_limit on public.note",
    ],
    ["row level security turned off", "alter table note disable row level security;", "disables row level security on public.note"],
    ["a revoked table privilege", "revoke insert on table note from cvh_app;", "revokes INSERT on table public.note from cvh_app"],
    [
      "a revoked view privilege",
      "revoke select on note_feed from cvh_app;",
      "revokes SELECT on table public.note_feed from cvh_app",
    ],
    [
      "a revoked function privilege",
      "revoke execute on function note_count() from public, cvh_app;",
      "revokes EXECUTE on function public.note_count() from cvh_app",
    ],
    ["a revoked sequence privilege", "revoke usage on sequence note_seq from cvh_app;", "revokes USAGE on sequence public.note_seq from cvh_app"],
    ["a revoked schema privilege", "revoke usage on schema public from public, cvh_app;", "revokes USAGE on schema public from cvh_app"],
    [
      "a renamed enum value",
      "alter type mood rename value 'bad' to 'poor';",
      "removes value 'bad' from enum type public.mood (dropped or renamed)",
    ],
    [
      "a dropped enum type",
      "alter table note drop column mood; drop type mood;",
      "removes enum type public.mood (dropped, renamed or moved)",
    ],
  ])("reports %s", async (_name, sql, change) => {
    const changes = await changesBy(sql);

    expect(changes.some((c) => c.startsWith(change)), `${change} in ${JSON.stringify(changes)}`).toBe(true);
  });

  it.each([
    ["a new table, with every kind of constraint", "create table extra (id int primary key, n int not null check (n > 0), s int references staff (id), u text unique);"],
    ["a nullable column", "alter table note add column tag text;"],
    ["a not null column with a default", "alter table note add column flag boolean not null default false;"],
    ["a unique constraint on a column added in the same migration", "alter table note add column code text unique;"],
    ["a foreign key on a column added in the same migration", "alter table note add column staff_id int references staff (id);"],
    ["a constraint added NOT VALID", "alter table note add constraint body_short check (length(body) < 100) not valid;"],
    ["a renamed constraint", "alter table note add constraint c check (id > 0) not valid; alter table note rename constraint c to d;"],
    ["a dropped not null", "alter table note alter column kind drop not null;"],
    ["a new default", "alter table note alter column body set default 'x';"],
    ["a dropped constraint", "alter table note drop constraint note_pkey;"],
    ["a new view, function, policy and enum value", "create view v as select 1 as one; create function f() returns int language sql as $$ select 1 $$; create policy p on note for select to cvh_app using (true); alter type mood add value 'great';"],
    ["a new privilege for the app", "grant update on table note to cvh_app; grant select on table staff to cvh_app;"],
    ["a revoke from a client role", "revoke all on table note from anon, authenticated;"],
    ["a replaced function with the same result", "create or replace function note_count() returns bigint language sql stable as $$ select 0::bigint $$;"],
  ])("does not report %s", async (_name, sql) => {
    expect(await changesBy(sql)).toEqual([]);
  });

  it("does not report a dropped table's privileges, policies and constraints again", async () => {
    expect(await changesBy("drop view note_feed; drop table note;")).toEqual([
      "removes table public.note (dropped, renamed or moved)",
      "removes view public.note_feed (dropped, renamed or moved)",
    ]);
  });

  it("does not report validating a constraint that was added NOT VALID", async () => {
    files.write("20260101000002_add.sql", "alter table note add constraint body_short check (length(body) < 100) not valid;");
    files.write("20260101000003_validate.sql", "alter table note validate constraint body_short;");

    const { removals } = await migrate({ sql: db.sql, dir: files.dir, recordRemovals: true });

    expect(removals["20260101000002_add.sql"]).toEqual([]);
    expect(removals["20260101000003_validate.sql"]).toEqual([]);
  });

  it("sees a change made inside a DO block or by EXECUTE", async () => {
    const changes = await changesBy(
      `do $$ begin execute 'alter table note alter column body set not null'; execute 'revoke select on table note from cvh_app'; end $$;`,
    );

    expect(changes).toEqual([
      "makes column public.note.body not null (the previous release may still write nulls)",
      "revokes SELECT on table public.note from cvh_app",
    ]);
  });
});
