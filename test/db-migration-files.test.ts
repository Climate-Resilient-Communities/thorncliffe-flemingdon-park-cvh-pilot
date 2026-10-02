import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checksum, readMigrations } from "../scripts/db/migrations.mjs";
import { findDestructiveChanges, findTransactionProblems, lexSql } from "../scripts/db/sql.mjs";

function withDir(files: Record<string, string>, test: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "cvh-files-"));
  try {
    for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(dir, name), sql);
    test(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("db/migrations", () => {
  const migrations = readMigrations();

  it("first migration enables pg_cron and pg_net and creates nothing else", () => {
    const statements = lexSql(migrations[0].sql).statements.map((s) => s.code.toLowerCase());

    expect(statements).toEqual([
      "create extension if not exists pg_cron with schema pg_catalog",
      "create extension if not exists pg_net with schema extensions",
    ]);
  });

  it("every migration can run in the runner's transaction and is not destructive without a contract", () => {
    for (const migration of migrations) {
      expect(findTransactionProblems(migration.sql), migration.file).toEqual([]);
      if (!/^--\s*contract:/im.test(migration.sql)) {
        expect(findDestructiveChanges(migration.sql), migration.file).toEqual([]);
      }
    }
  });
});

describe("reading migration files", () => {
  it("orders by version and checksums the content", () => {
    withDir({ "20260101000002_b.sql": "select 2;\n", "20260101000001_a.sql": "select 1;\n" }, (dir) => {
      const migrations = readMigrations(dir);

      expect(migrations.map((m) => [m.version, m.name])).toEqual([
        ["20260101000001", "a"],
        ["20260101000002", "b"],
      ]);
      expect(migrations[0].checksum).toBe(checksum("select 1;\n"));
    });
  });

  it("refuses badly named files and repeated versions", () => {
    withDir(
      { "init.sql": "", "20260101000001_a.sql": "", "20260101000001_b.sql": "", "2026010100000_short.sql": "" },
      (dir) => {
        expect(() => readMigrations(dir)).toThrow(/- init\.sql: migration files are named/);
        expect(() => readMigrations(dir)).toThrow(/- 2026010100000_short\.sql: migration files are named/);
        expect(() => readMigrations(dir)).toThrow(
          /- 20260101000001_b\.sql: version 20260101000001 is also used by 20260101000001_a\.sql/,
        );
      },
    );
  });

  it("ignores line endings in the checksum only", () => {
    expect(checksum("select 1;\r\n")).toBe(checksum("select 1;\n"));
    expect(checksum("select 1;\n")).not.toBe(checksum("select 2;\n"));
  });
});
