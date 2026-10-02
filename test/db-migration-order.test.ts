import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findMisorderedMigrations } from "../scripts/db/check-destructive.mjs";

const base = ["20261002000000_a.sql", "20261002100000_b.sql"];

describe("migration order check", () => {
  it("fails a new migration older than the newest on the base", () => {
    const problems = findMisorderedMigrations(["20261002020000_c.sql"], base);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("rename it with a later timestamp than 20261002100000");
  });

  it("fails a new migration with the newest version itself", () => {
    expect(findMisorderedMigrations(["20261002100000_c.sql"], base)).toHaveLength(1);
  });

  it("passes a newer migration, and no new migrations", () => {
    expect(findMisorderedMigrations(["20261002110000_c.sql"], base)).toEqual([]);
    expect(findMisorderedMigrations([], base)).toEqual([]);
  });

  it("exits non-zero in a git checkout where the branch adds an older migration, zero for a newer one", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "order-"));
    const identity = ["-c", "user.email=a@b.c", "-c", "user.name=t"];
    const git = (...args: string[]) => spawnSync("git", [...identity, ...args], { cwd: repo, encoding: "utf8" });
    const dir = path.join(repo, "db", "migrations");
    const check = () =>
      spawnSync("node", [path.resolve("scripts/db/check-destructive.mjs"), "--base", "main", "--dir", dir], {
        cwd: repo,
        encoding: "utf8",
      });
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "20261002100000_b.sql"), "select 1;\n");
      git("init", "-q", "-b", "main");
      git("add", "-A");
      git("commit", "-qm", "base");
      git("checkout", "-qb", "branch");
      writeFileSync(path.join(dir, "20261002020000_old.sql"), "select 2;\n");
      git("add", "-A");
      git("commit", "-qm", "old");

      const failing = check();
      expect(failing.status).toBe(1);
      expect(failing.stderr).toContain("rename it with a later timestamp than 20261002100000");

      git("mv", "db/migrations/20261002020000_old.sql", "db/migrations/20261002110000_old.sql");
      git("commit", "-qam", "rename");
      expect(check().status).toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
