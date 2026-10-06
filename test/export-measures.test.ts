// scripts/export-measures without a database (S09.05): its arguments, the editions as the role policy says who sees spend (AD-4), the two files it reads, checked
// before it connects, and its refusal of an environment it cannot use. The runs against the views, both editions' files, the small-number rule, the rehearsal
// alerts left out and the absence of personal data are in test/db/pilotMeasures.db.test.ts.
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { editionMatchesPolicy, runExportMeasures } from "../scripts/ops/export-measures";
import { MEASURE_EDITIONS, SURVEY_HEADER } from "../src/modules/ops";
import type { Db } from "../src/platform/db";

const ROOT = path.join(__dirname, "..");
const ENV = { DATABASE_URL: "postgres://unused", SMS_MODE: "log", PUBLIC_BASE_URL: "http://localhost:3000" };
const OUT = ["--out-dir", "out"];
const LOG = "## Alerts sent for a rehearsal\n\n| Alert entry id | Date | Rehearsal |\n| --- | --- | --- |\n| | | |\n";

async function run(argv: string[], options: { env?: Record<string, string>; files?: Record<string, string> } = {}) {
  const out: string[] = [];
  const error: string[] = [];
  const connect = vi.fn(() => ({ db: {} as Db, close: async () => {} }));
  const files = options.files ?? { rehearsals: LOG, survey: `${SURVEY_HEADER}\n` };
  const code = await runExportMeasures(argv, {
    env: options.env ?? ENV,
    now: () => new Date("2026-10-14T15:00:00Z"),
    out: (line) => out.push(line),
    error: (line) => error.push(line),
    root: ROOT,
    read: (file) => {
      const text = file.endsWith(".md") ? files.rehearsals : files.survey;
      if (text === undefined) throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT", path: file });
      return text;
    },
    write: () => {},
    connect,
  });
  return { code, out: out.join("\n"), error: error.join("\n"), connect };
}

describe("export-measures", () => {
  it("needs an edition, director or coordinator, and refuses anything else before connecting", async () => {
    for (const argv of [[], ["--edition", "ambassador"], ["--edition", "admin"], ["--edition"], ["--bogus"], ["director"]]) {
      const result = await run([...argv, ...OUT]);
      expect(result.code, argv.join(" ")).toBe(2);
      expect(result.error).toContain("Usage");
      expect(result.connect).not.toHaveBeenCalled();
    }
  });

  it("needs the folder to write to, so the files never land where it happens to run (the repository's working tree)", async () => {
    for (const argv of [["--edition", "director"], ["--edition", "coordinator", "--out-dir", ""], ["--edition", "director", "--out-dir", "  "]]) {
      const result = await run(argv);
      expect(result.code, argv.join(" ")).toBe(2);
      expect(result.error).toContain("--out-dir is required");
      expect(result.connect).not.toHaveBeenCalled();
    }
  });

  it("refuses a week that is not a Monday, before connecting", async () => {
    for (const week of ["2026-10-06", "2026-02-30", "soon"]) {
      const result = await run(["--edition", "coordinator", "--week", week, ...OUT]);
      expect(result.code).toBe(2);
      expect(result.error).toContain("--week must be a Monday");
      expect(result.connect).not.toHaveBeenCalled();
    }
  });

  it("names its editions after the roles the policy gives counts to, with spend exactly where the policy gives spend (AD-4)", () => {
    expect(MEASURE_EDITIONS).toEqual(["director", "coordinator"]);
    for (const edition of MEASURE_EDITIONS) expect(editionMatchesPolicy(edition), edition).toBe(true);
  });

  it("refuses an environment it cannot use, naming what is wrong, before connecting", async () => {
    const missing = await run(["--edition", "director", ...OUT], { env: { SMS_MODE: "log", PUBLIC_BASE_URL: "http://localhost:3000" } });
    expect(missing.code).toBe(1);
    expect(missing.error).toContain("DATABASE_URL is not set");
    const invalid = await run(["--edition", "director", ...OUT], { env: { ...ENV, SPEND_PILOT_BUDGET_CENTS: "a lot" } });
    expect(invalid.code).toBe(1);
    expect(invalid.error).toContain("SPEND_PILOT_BUDGET_CENTS");
    expect(missing.connect).not.toHaveBeenCalled();
    expect(invalid.connect).not.toHaveBeenCalled();
  });

  it("refuses a rehearsal log or a survey file with a mistake, naming the file and the line, before connecting", async () => {
    const badLog = await run(["--edition", "director", ...OUT], { files: { rehearsals: `${LOG}| not-an-id | 2026-10-01 | resend |\n`, survey: `${SURVEY_HEADER}\n` } });
    expect(badLog.code).toBe(1);
    expect(badLog.error).toMatch(/docs\/procedures\/rehearsals\.md, line 6: "not-an-id" is not an alert entry id/);
    const badSurvey = await run(["--edition", "coordinator", ...OUT], { files: { rehearsals: LOG, survey: `${SURVEY_HEADER}\n2026-10-01,ur,5,6\n` } });
    expect(badSurvey.code).toBe(1);
    expect(badSurvey.error).toMatch(/docs\/procedures\/survey-results\.csv, line 2: understood cannot be more than asked/);
    const noSurvey = await run(["--edition", "coordinator", ...OUT], { files: { rehearsals: LOG } });
    expect(noSurvey.code).toBe(1);
    expect(noSurvey.error).toContain("cannot read");
    for (const result of [badLog, badSurvey, noSurvey]) expect(result.connect).not.toHaveBeenCalled();
  });

  it("reads the two files from the repository by default, and from the paths given", async () => {
    const read = vi.fn((file: string) => (file.endsWith(".md") ? LOG : "nope"));
    const code = await runExportMeasures(["--edition", "director", ...OUT, "--rehearsals", "elsewhere/log.md", "--survey", "elsewhere/survey.csv"], {
      env: ENV,
      now: () => new Date(),
      out: () => {},
      error: () => {},
      root: ROOT,
      read,
      connect: () => {
        throw new Error("not reached");
      },
    });
    expect(code).toBe(1);
    expect(read.mock.calls.map(([file]) => file)).toEqual(["elsewhere/log.md", "elsewhere/survey.csv"]);
    const defaults = vi.fn((file: string) => (file.endsWith(".md") ? LOG : "nope"));
    await runExportMeasures(["--edition", "director", ...OUT], { env: ENV, now: () => new Date(), out: () => {}, error: () => {}, root: ROOT, read: defaults });
    expect(defaults.mock.calls.map(([file]) => path.relative(ROOT, file))).toEqual([path.join("docs", "procedures", "rehearsals.md"), path.join("docs", "procedures", "survey-results.csv")]);
  });
});
