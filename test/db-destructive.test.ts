import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { checkDestructiveMigrations, lookUpProductionRelease } from "../scripts/db/contracts.mjs";
import { findDestructiveChanges, findTransactionProblems, lexSql, readContractNotes } from "../scripts/db/sql.mjs";

describe("destructive change detection", () => {
  it.each([
    ["drop table audit_event;", "drops table audit_event"],
    ["DROP TABLE IF EXISTS public.audit_event CASCADE;", "drops table public.audit_event"],
    ["drop schema ops cascade;", "drops schema ops (and every table in it)"],
    ["alter table audit_event drop column detail;", "drops column audit_event.detail"],
    ["alter table audit_event drop detail;", "drops column audit_event.detail"],
    ["ALTER TABLE IF EXISTS ONLY audit_event DROP COLUMN IF EXISTS detail;", "drops column audit_event.detail"],
    ['alter table "audit_event" drop column "Detail";', 'drops column "audit_event"."Detail"'],
    ["alter table audit_event rename to audit_log;", "renames table audit_event to audit_log"],
    ["alter table audit_event rename column detail to details;", "renames column audit_event.detail to details"],
    ["alter table audit_event rename detail to details;", "renames column audit_event.detail to details"],
    ["alter table audit_event set schema audit;", "moves table audit_event to schema audit"],
    [
      "alter table audit_event alter column action type varchar(20);",
      "changes the type of column audit_event.action to varchar(20) (may narrow it)",
    ],
    [
      "alter table audit_event alter action set data type numeric(10, 2) using action::numeric;",
      "changes the type of column audit_event.action to numeric(10, 2) (may narrow it)",
    ],
    ["alter table audit_event alter column detail set not null;", "makes column audit_event.detail not null (the previous release may still write nulls)"],
    ["alter table audit_event alter detail set not null;", "makes column audit_event.detail not null (the previous release may still write nulls)"],
    [
      "alter table audit_event add column note text not null;",
      "adds column audit_event.note as not null without a default (the previous release does not write it)",
    ],
    [
      "alter table audit_event add note varchar(20) not null;",
      "adds column audit_event.note as not null without a default (the previous release does not write it)",
    ],
    [
      "alter table audit_event add column if not exists note text not null check (note <> '');",
      "adds column audit_event.note as not null without a default (the previous release does not write it)",
    ],
    [
      "alter table audit_event alter column detail drop default;",
      "drops the default of column audit_event.detail (the previous release may rely on it)",
    ],
    [
      "alter table audit_event add constraint detail_len check (length(detail) < 20);",
      "adds a check constraint to audit_event (rows the previous release writes may violate it; add it NOT VALID and validate later)",
    ],
    [
      "alter table audit_event add check (detail <> '');",
      "adds a check constraint to audit_event (rows the previous release writes may violate it; add it NOT VALID and validate later)",
    ],
    [
      "alter table audit_event add constraint staff_fk foreign key (actor) references staff (id);",
      "adds a foreign key constraint to audit_event (rows the previous release writes may violate it; add it NOT VALID and validate later)",
    ],
    [
      "alter table audit_event add constraint detail_key unique (detail);",
      "adds a unique constraint to audit_event (rows the previous release writes may violate it; add it NOT VALID and validate later)",
    ],
    [
      "alter table audit_event add primary key (id);",
      "adds a primary key constraint to audit_event (rows the previous release writes may violate it; add it NOT VALID and validate later)",
    ],
    ["drop view weekly_review;", "drops view weekly_review"],
    ["drop materialized view if exists weekly_review cascade;", "drops materialized view weekly_review"],
    ["drop function audit_event_append_only();", "drops function audit_event_append_only()"],
    ["drop function if exists public.f(int) cascade;", "drops function public.f(int)"],
    ["drop procedure p();", "drops procedure p()"],
    ["drop policy audit_event_app_select on audit_event;", "drops policy audit_event_app_select on audit_event"],
    ["drop policy if exists p on public.audit_event;", "drops policy p on public.audit_event"],
    ["revoke select on table audit_event from cvh_app;", "revokes privileges from the app role cvh_app"],
    ["REVOKE ALL ON ALL TABLES IN SCHEMA public FROM public, cvh_app CASCADE;", "revokes privileges from the app role cvh_app"],
    ['revoke insert on audit_event from "cvh_app";', "revokes privileges from the app role cvh_app"],
    ["revoke execute on function f() from group cvh_app;", "revokes privileges from the app role cvh_app"],
    ["revoke cvh_app from cvh_app_login;", "revokes the role cvh_app from a login role (the app loses all its access)"],
    ["alter type mood rename value 'sad' to 'blue';", "renames a value of enum type mood"],
    ["drop type mood;", "drops type mood"],
    ["drop type if exists public.mood cascade;", "drops type public.mood"],
    ["alter table audit_event disable row level security;", "disables row level security on audit_event"],
    ["alter view weekly_review rename to weekly;", "renames view weekly_review or one of its columns"],
  ])("flags %s", (sql, change) => {
    expect(findDestructiveChanges(sql)).toEqual([change]);
  });

  it("flags each destructive action of a multi-action ALTER TABLE", () => {
    const sql = "alter table a add column x int, drop column y, alter column z type int, rename constraint c to d;";

    expect(findDestructiveChanges(sql)).toEqual([
      "drops column a.y",
      "changes the type of column a.z to int (may narrow it)",
    ]);
  });

  it.each([
    "create table audit_event (id int primary key, detail text);",
    "alter table audit_event add column note text;",
    "alter table audit_event drop constraint audit_event_detail_check;",
    "alter table audit_event alter column detail drop not null;",
    "alter table audit_event rename constraint a to b;",
    "alter table audit_event enable row level security;",
    "alter table audit_event alter column detail set default 'x';",
    "alter table audit_event add column note text not null default '';",
    "alter table audit_event add column note text not null generated always as (detail || 'x') stored;",
    "alter table audit_event add column id2 bigint generated always as identity not null;",
    "alter table audit_event add column note text;",
    "alter table audit_event add column note text check (note is not null);",
    "alter table audit_event add constraint detail_len check (length(detail) < 20) not valid;",
    "alter table audit_event add constraint staff_fk foreign key (actor) references staff (id) not valid;",
    "alter table audit_event validate constraint detail_len;",
    "revoke select on table audit_event from anon, authenticated;",
    "revoke all on table audit_event from public, cvh_app_login;",
    "grant select on table audit_event to cvh_app;",
    "create view weekly_review as select 1;",
    "alter type mood add value 'blue';",
    "drop trigger t on audit_event;",
    "alter table audit_event no force row level security;",
    "drop index audit_event_idx;",
    "-- drop table audit_event;\nselect 1;",
    "/* drop table audit_event; /* nested */ still a comment */ select 1;",
    "select 'drop table audit_event';",
    "select E'it\\'s; drop table audit_event';",
    "create function f() returns void language sql as $$ drop table audit_event; $$;",
    "create function g() returns void language plpgsql as $body$ begin drop table audit_event; end $body$;",
  ])("does not flag %s", (sql) => {
    expect(findDestructiveChanges(sql)).toEqual([]);
  });

  it("splits statements outside comments, strings and dollar quotes", () => {
    const { statements, comments } = lexSql("select ';'; -- note; here\ncreate function f() as $$ a; b $$;\n");

    expect(statements.map((s) => s.code)).toEqual(["select ''", "create function f() as ''"]);
    expect(comments).toEqual(["-- note; here"]);
  });
});

describe("contract notes", () => {
  it("reads the release named by each note", () => {
    const sql = "-- contract: 0123ABCdef stopped reading detail in S04.02\n-- Contract: 89abcdef0123\nselect 1;";

    expect(readContractNotes(sql)).toEqual({ releases: ["0123abcdef", "89abcdef0123"], problems: [] });
  });

  it("rejects a note that names no release", () => {
    expect(readContractNotes("-- contract: the next release\n").problems).toEqual([
      expect.stringMatching(/does not name a release/),
    ]);
  });

  it("ignores a contract note inside a string", () => {
    expect(readContractNotes("select '-- contract: 0123abcdef';").releases).toEqual([]);
  });
});

describe("transaction problems", () => {
  it("flags statements that need their own transaction or none", () => {
    const sql = "begin;\ncreate index concurrently i on t (c);\nvacuum t;\ncommit;\n";

    expect(findTransactionProblems(sql)).toHaveLength(4);
  });

  it("allows ordinary DDL and plpgsql blocks", () => {
    const sql = "create table t (c int);\ndo $$ begin perform 1; end $$;\ncreate index i on t (c);\n";

    expect(findTransactionProblems(sql)).toEqual([]);
  });

  it("keeps a SQL-standard function body (BEGIN ATOMIC ... END) in one statement", () => {
    const sql =
      "create function f(x int) returns text language sql begin atomic select case when x > 0 then 'a' else 'b' end; end;\n" +
      "create procedure p() language sql BEGIN ATOMIC insert into t values (1); insert into t values (2); END;\n" +
      "drop table t;\n";

    expect(findTransactionProblems(sql)).toEqual([]);
    expect(lexSql(sql).statements.map((s) => s.code.slice(0, 18))).toEqual([
      "create function f(",
      "create procedure p",
      "drop table t",
    ]);
    expect(findDestructiveChanges(sql)).toEqual(["drops table t"]);
  });
});

describe("expand/contract check against the release in production", () => {
  let repo: string;
  const commits: Record<string, string> = {};

  const git = (args: string[], cwd = repo) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), "cvh-contracts-"));
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    for (const name of ["expand", "stop-using", "after-production"]) {
      writeFileSync(path.join(repo, "app.txt"), name);
      git(["add", "app.txt"]);
      git(["commit", "-q", "-m", name]);
      commits[name] = git(["rev-parse", "HEAD"]);
    }
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const DROP = "alter table audit_event drop column detail;\n";
  const check = (sql: string, production: () => Promise<string> = async () => commits["stop-using"]) =>
    checkDestructiveMigrations([{ file: "20260101000001_drop_detail.sql", sql }], {
      productionRelease: production,
      cwd: repo,
    });

  it("passes a migration with no destructive change without asking production", async () => {
    const production = vi.fn(async () => commits["stop-using"]);

    expect(await check("alter table audit_event add column note text;\n", production)).toEqual([]);
    expect(production).not.toHaveBeenCalled();
  });

  it("rejects a dropped column without a contract note", async () => {
    expect(await check(DROP)).toEqual([
      expect.stringMatching(/^20260101000001_drop_detail.sql drops column audit_event.detail\. The previous release may still use it/),
    ]);
  });

  it("passes when the named release is the one in production", async () => {
    expect(await check(`-- contract: ${commits["stop-using"]}\n${DROP}`)).toEqual([]);
  });

  it("passes when the named release is an ancestor of production (short SHA)", async () => {
    expect(await check(`-- contract: ${commits.expand.slice(0, 10)}\n${DROP}`)).toEqual([]);
  });

  it("rejects a release that is not in production yet", async () => {
    expect(await check(`-- contract: ${commits["after-production"]}\n${DROP}`)).toEqual([
      expect.stringMatching(/is not in production yet \(production runs [0-9a-f]{40}\)/),
    ]);
  });

  it("rejects a release that is not a commit", async () => {
    expect(await check(`-- contract: deadbeefdeadbeef\n${DROP}`)).toEqual([
      expect.stringMatching(/names deadbeefdeadbeef, which is not a commit in this repository/),
    ]);
  });

  it("rejects when the release in production cannot be read", async () => {
    const unreadable = async () => {
      throw new Error("could not read the release in production: https://cvh.example.ca/api/health answered 503");
    };

    expect(await check(`-- contract: ${commits.expand}\n${DROP}`, unreadable)).toEqual([
      expect.stringMatching(/answered 503$/),
    ]);
  });

  // The text check cannot see inside a DO block; CI reads what each migration
  // removed from its disposable database (removals.mjs) and passes it in.
  const HIDDEN = "do $$ begin execute 'alter table audit_event drop column detail'; end $$;\n";
  const REMOVED = { "20260101000001_drop_detail.sql": ["removes column public.audit_event.detail (dropped or renamed)"] };

  it("rejects a removal read from the database that the text check cannot see", async () => {
    const problems = await checkDestructiveMigrations([{ file: "20260101000001_drop_detail.sql", sql: HIDDEN }], {
      productionRelease: async () => commits["stop-using"],
      cwd: repo,
      databaseChanges: REMOVED,
    });

    expect(problems).toEqual([
      expect.stringMatching(/^20260101000001_drop_detail.sql removes column public.audit_event.detail \(dropped or renamed\)\. The previous release/),
    ]);
  });

  it("checks a contract note's release even when no change is detected (the production job has no database diff)", async () => {
    expect(await check(`-- contract: ${commits["after-production"]}\n${HIDDEN}`)).toEqual([
      expect.stringMatching(/carries a contract note, but the release named in its contract note .* is not in production yet/),
    ]);
    expect(await check(`-- contract: ${commits["stop-using"]}\n${HIDDEN}`)).toEqual([]);
  });

  it("rejects when production runs a commit missing from the checkout", async () => {
    const unknown = async () => "f".repeat(40);

    expect(await check(`-- contract: ${commits.expand}\n${DROP}`, unknown)).toEqual([
      expect.stringMatching(/not in this checkout's history/),
    ]);
  });

  describe("CLI with --base", () => {
    it("checks only the migrations the branch adds or changes", () => {
      mkdirSync(path.join(repo, "db", "migrations"), { recursive: true });
      // Already on main: destructive, but not this branch's change.
      writeFileSync(path.join(repo, "db/migrations/20260101000001_old.sql"), DROP);
      git(["add", "."]);
      git(["commit", "-q", "-m", "old migration"]);
      git(["checkout", "-q", "-b", "feature"]);
      writeFileSync(path.join(repo, "db/migrations/20260101000002_new.sql"), "drop table audit_event;\n");

      const result = spawnSync(
        "node",
        [path.join(__dirname, "..", "scripts/db/check-destructive.mjs"), "--base", "main", "--dir", "db/migrations"],
        { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true", PRODUCTION_URL: "" } },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/Checking 1 migration\(s\)/);
      expect(result.stdout).toMatch(/::error title=Destructive migration::20260101000002_new.sql drops table audit_event/);
      expect(result.stdout).not.toMatch(/20260101000001_old.sql/);
    });

    it("uses the removals report of the migrated CI database", () => {
      writeFileSync(path.join(repo, "db/migrations/20260101000002_new.sql"), HIDDEN);
      const report = path.join(repo, "removals.json");
      writeFileSync(report, JSON.stringify({ "20260101000002_new.sql": ["removes table public.audit_event (dropped, renamed or moved)"] }));

      const result = spawnSync(
        "node",
        [path.join(__dirname, "..", "scripts/db/check-destructive.mjs"), "--base", "main", "--dir", "db/migrations", "--removals", report],
        { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true", PRODUCTION_URL: "" } },
      );
      rmSync(report);

      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/::error title=Destructive migration::20260101000002_new.sql removes table public.audit_event/);
    });

    it("warns about an edit to a migration that is already on the base branch", () => {
      writeFileSync(path.join(repo, "db/migrations/20260101000002_new.sql"), "select 1;\n");
      writeFileSync(path.join(repo, "db/migrations/20260101000001_old.sql"), `-- contract: ${commits.expand}\n${DROP}`);

      const result = spawnSync(
        "node",
        [path.join(__dirname, "..", "scripts/db/check-destructive.mjs"), "--base", "main", "--dir", "db/migrations"],
        {
          cwd: repo,
          encoding: "utf8",
          env: { ...process.env, GITHUB_ACTIONS: "true", PRODUCTION_RELEASE: commits["stop-using"] },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/::warning title=Migration edited::20260101000001_old.sql already exists on main/);
    });
  });
});

describe("reading the release in production", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const SHA = "0123456789abcdef0123456789abcdef01234567";

  it("asks the production health endpoint", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: "ok", version: SHA }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    expect(await lookUpProductionRelease({ PRODUCTION_URL: "https://cvh.example.ca/" })).toBe(SHA);
    expect(fetch).toHaveBeenCalledWith("https://cvh.example.ca/api/health", expect.anything());
  });

  it("prefers PRODUCTION_RELEASE when set", async () => {
    expect(await lookUpProductionRelease({ PRODUCTION_RELEASE: SHA, PRODUCTION_URL: "https://x" })).toBe(SHA);
  });

  it("fails without PRODUCTION_URL", async () => {
    await expect(lookUpProductionRelease({})).rejects.toThrow(/PRODUCTION_URL is not set/);
  });

  it("fails on an error status or a version that is not a commit", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    await expect(lookUpProductionRelease({ PRODUCTION_URL: "https://cvh.example.ca" })).rejects.toThrow(/answered 404/);

    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ version: "dev" }), { status: 200 }));
    await expect(lookUpProductionRelease({ PRODUCTION_URL: "https://cvh.example.ca" })).rejects.toThrow(
      /did not report a commit SHA/,
    );
  });
});

describe("CLI on a push to main", () => {
  let repo: string;
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const run = (base: string) =>
    spawnSync("node", [path.join(__dirname, "..", "scripts/db/check-destructive.mjs"), "--base", base, "--dir", "db/migrations"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, PRODUCTION_URL: "" },
    });

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), "cvh-main-push-"));
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    mkdirSync(path.join(repo, "db", "migrations"), { recursive: true });
    writeFileSync(path.join(repo, "db/migrations/20260101000001_first.sql"), "create table t (id int);\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "first"]);
    // The merge of a branch that adds a destructive migration, as a push to main sees it.
    git(["checkout", "-q", "-b", "feature"]);
    writeFileSync(path.join(repo, "db/migrations/20260101000002_drop.sql"), "drop table t;\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "drop"]);
    git(["checkout", "-q", "main"]);
    git(["merge", "-q", "--no-ff", "-m", "merge feature", "feature"]);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("checks nothing when HEAD is compared with itself (origin/main on a push to main)", () => {
    const result = run("HEAD");

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Checking 0 migration\(s\)/);
  });

  it("checks the merged migrations against the first parent, HEAD~1", () => {
    const result = run("HEAD~1");

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/Checking 1 migration\(s\)/);
    expect(result.stderr).toMatch(/20260101000002_drop.sql drops table t/);
  });
});
