// scripts/export-weekly without a database: its arguments, its default week and what it prints. The runs against the view are in test/db/weeklyReview.db.test.ts.
import { describe, expect, it, vi } from "vitest";
import { runExportWeekly } from "../scripts/ops/export-weekly";
import type { Db } from "../src/platform/db";

const NOW = new Date("2026-10-14T15:00:00Z");

async function run(argv: string[], env: Record<string, string> = { DATABASE_URL: "postgres://unused" }) {
  const out: string[] = [];
  const error: string[] = [];
  const written: Record<string, string> = {};
  const execute = vi.fn(async () => []);
  const connect = vi.fn(() => ({ db: { execute } as unknown as Db, close: async () => {} }));
  const code = await runExportWeekly(argv, {
    env,
    now: () => NOW,
    out: (l) => out.push(l),
    error: (l) => error.push(l),
    write: (file, content) => void (written[file] = content),
    connect,
  });
  return { code, out: out.join("\n"), error: error.join("\n"), written, connect, execute };
}

describe("export-weekly", () => {
  it("refuses a week that is not a Monday, or an option it does not know, before connecting", async () => {
    for (const argv of [["--week", "2026-10-06"], ["--week", "soon"], ["--bogus"], ["--week"]]) {
      const result = await run(argv);
      expect(result.code).toBe(2);
      expect(result.error).toContain("Usage");
      expect(result.connect).not.toHaveBeenCalled();
    }
  });

  it("refuses to run without a database connection", async () => {
    const result = await run([], {});
    expect(result.code).toBe(1);
    expect(result.error).toContain("DATABASE_URL");
    expect(result.connect).not.toHaveBeenCalled();
  });

  it("writes the last complete week's CSV to a file named for the week, and says where the notes go", async () => {
    const result = await run([]);

    expect(result.code).toBe(0);
    expect(Object.keys(result.written)).toEqual(["weekly-review-2026-10-05.csv"]);
    expect(result.written["weekly-review-2026-10-05.csv"].split("\r\n")[0]).toMatch(/^week_start,section,is_drill,/);
    expect(result.out).toContain("docs/procedures/weekly-notes/2026-10-05.md");
    expect(result.execute).toHaveBeenCalledTimes(1);
  });

  it("writes the named week to the named file", async () => {
    const result = await run(["--week", "2026-09-28", "--out", "somewhere.csv"]);
    expect(result.code).toBe(0);
    expect(Object.keys(result.written)).toEqual(["somewhere.csv"]);
    expect(result.out).toContain("2026-09-28");
  });
});
