// The search test set (S03.01): the question format, the committed starter set, the runner against a
// fake engine, the report and the comparison, and the command line.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LANG_CODES } from "@/contracts/lang";
import { TestSetReportSchema, TestQuestionSchema, type TestQuestion } from "@/contracts/searchTestSet";
import {
  buildReport,
  compareReports,
  formatLineErrors,
  parseQuestions,
  percentile,
  providerIdsOf,
  reportFileName,
  runQuestions,
  type SearchEngine,
} from "../scripts/search-test-set/lib";

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "search-test-set", "index.mjs");
const IDS = providerIdsOf(readFileSync(path.join(ROOT, "data", "catalogue", "providers.json"), "utf8"));
const REAL = readFileSync(path.join(ROOT, "data", "search-test-set", "questions.jsonl"), "utf8");
const temp: string[] = [];

afterAll(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "cvh-test-set-"));
  temp.push(dir);
  return dir;
}

const base: TestQuestion = {
  id: "en-99",
  lang: "en",
  q: "Where can I get free food?",
  kind: "native",
  expected: ["M008"],
  split: "tuning",
  author_role: "developer",
  added: "2026-10-02",
  checked_by_role: null,
  checked_on: null,
};
const line = (changes: Record<string, unknown> = {}) => JSON.stringify({ ...base, ...changes });
const errorsOf = (text: string) => formatLineErrors(parseQuestions(text, IDS).errors, "f.jsonl");

describe("the question format", () => {
  it("accepts a complete question", () => {
    expect(TestQuestionSchema.safeParse(base).success).toBe(true);
  });

  it("limits the question to 200 characters, counting characters and not code units", () => {
    expect(TestQuestionSchema.safeParse({ ...base, q: "a".repeat(200) }).success).toBe(true);
    expect(TestQuestionSchema.safeParse({ ...base, q: "a".repeat(201) }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, q: "😀".repeat(200) }).success).toBe(true);
  });

  it("requires every field and refuses unknown ones, kinds, splits and languages", () => {
    for (const key of Object.keys(base)) {
      const rest: Record<string, unknown> = { ...base };
      delete rest[key];
      expect(TestQuestionSchema.safeParse(rest).success, `without ${key}`).toBe(false);
    }
    expect(TestQuestionSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, kind: "other" }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, split: "test" }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, lang: "de" }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, author_role: "intern" }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, added: "2 Oct 2026" }).success).toBe(false);
  });

  it("needs expected empty for no_match and at least one provider id for every other kind", () => {
    expect(TestQuestionSchema.safeParse({ ...base, kind: "no_match", expected: [] }).success).toBe(true);
    expect(TestQuestionSchema.safeParse({ ...base, kind: "no_match", expected: ["M008"] }).success).toBe(false);
    for (const kind of ["native", "romanized", "mixed", "emergency"]) {
      expect(TestQuestionSchema.safeParse({ ...base, kind, expected: [] }).success, kind).toBe(false);
      expect(TestQuestionSchema.safeParse({ ...base, kind, expected: ["M008", "M071"] }).success, kind).toBe(true);
    }
    expect(TestQuestionSchema.safeParse({ ...base, expected: ["M008", "M008"] }).success).toBe(false);
  });

  it("records the second check as a role and a date together", () => {
    expect(TestQuestionSchema.safeParse({ ...base, checked_by_role: "coordinator", checked_on: "2026-10-03" }).success).toBe(true);
    expect(TestQuestionSchema.safeParse({ ...base, checked_by_role: "coordinator" }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, checked_on: "2026-10-03" }).success).toBe(false);
  });
});

describe("validating a questions file", () => {
  it("reports each problem with its line number", () => {
    const text = [
      line({ id: "en-01" }),
      "",
      "{not json",
      line({ id: "en-02", q: "a".repeat(201) }),
      line({ id: "en-03", kind: "no_match" }),
      line({ id: "en-04", expected: ["M008", "M9999"] }),
      line({ id: "en-01" }),
    ].join("\n");

    expect(errorsOf(text)).toEqual([
      expect.stringMatching(/^f\.jsonl:3: not valid JSON/),
      "f.jsonl:4: q: must be at most 200 characters",
      "f.jsonl:5: expected: must be empty for a no_match question",
      "f.jsonl:6: expected: provider id M9999 is not in data/catalogue/providers.json",
      "f.jsonl:7: id: en-01 is already used on line 1",
    ]);
  });

  it("returns the valid questions with their line numbers", () => {
    const { questions, errors } = parseQuestions(`${line({ id: "a-1" })}\n\n${line({ id: "a-2" })}\n`, IDS);
    expect(errors).toEqual([]);
    expect(questions.map((q) => [q.id, q.line])).toEqual([["a-1", 1], ["a-2", 3]]);
  });
});

describe("the committed starter set", () => {
  const { questions, errors } = parseQuestions(REAL, IDS);

  it("passes the schema and names only providers of data/catalogue/providers.json", () => {
    expect(errors).toEqual([]);
  });

  it("has at least 2 questions in each of the 15 launch languages (and no other)", () => {
    const launch = LANG_CODES.filter((l) => l !== "zh-Hant");
    expect(launch).toHaveLength(15);
    for (const lang of launch) expect(questions.filter((q) => q.lang === lang).length, lang).toBeGreaterThanOrEqual(2);
    expect(questions.filter((q) => q.lang === "zh-Hant")).toEqual([]);
    expect(questions.length).toBeGreaterThanOrEqual(28);
    expect(questions.length).toBeLessThanOrEqual(35);
  });

  it("has 2 romanized Urdu, 1 Hinglish, 2 emergency and 2 no-match questions", () => {
    expect(questions.filter((q) => q.lang === "ur" && q.kind === "romanized").length).toBeGreaterThanOrEqual(2);
    expect(questions.filter((q) => q.lang === "hi" && q.kind === "mixed").length).toBeGreaterThanOrEqual(1);
    expect(questions.filter((q) => q.kind === "emergency").length).toBeGreaterThanOrEqual(2);
    expect(questions.filter((q) => q.kind === "no_match").length).toBeGreaterThanOrEqual(2);
  });

  it("puts questions of both kinds that matter in both subsets", () => {
    for (const split of ["tuning", "evaluation"]) {
      expect(questions.some((q) => q.split === split && q.kind === "emergency"), split).toBe(true);
      expect(questions.some((q) => q.split === split && q.kind === "no_match"), split).toBe(true);
    }
  });

  it("has unique question texts", () => {
    expect(new Set(questions.map((q) => q.q)).size).toBe(questions.length);
  });
});

// --- the runner, with a fake engine ---------------------------------------------------------------

const q = (id: string, lang: TestQuestion["lang"], kind: TestQuestion["kind"], expected: string[], split: TestQuestion["split"] = "tuning"): TestQuestion => ({
  ...base,
  id,
  lang,
  q: `question ${id}`,
  kind,
  expected,
  split,
});

const QUESTIONS: TestQuestion[] = [
  q("en-1", "en", "native", ["M008"]), // answered at rank 1
  q("en-2", "en", "native", ["M008"]), // answered at rank 4: top 5 only
  q("en-3", "en", "emergency", ["M002"]), // 911 first, answered
  q("ur-1", "ur", "romanized", ["M008"]), // missed
  q("ur-2", "ur", "no_match", []), // wrongly answered
  q("fr-1", "fr", "no_match", []), // correct no match
  q("fr-2", "fr", "native", ["M022"], "evaluation"), // answered at rank 2
];

const ANSWERS: Record<string, { ids: string[]; emergency?: boolean }> = {
  "question en-1": { ids: ["M008", "M071"] },
  "question en-2": { ids: ["M001", "M002", "M003", "M008"] },
  "question en-3": { ids: ["M002"], emergency: true },
  "question ur-1": { ids: ["M060", "M061", "M062"] },
  "question ur-2": { ids: ["M060"] },
  "question fr-1": { ids: [] },
  "question fr-2": { ids: ["M001", "M022"] },
};

const fake: SearchEngine = async ({ q: text }) => {
  const answer = ANSWERS[text]!;
  return { status: answer.ids.length === 0 ? "no_clear_match" : "ok", emergency_first: answer.emergency ?? false, results: answer.ids.map((id) => ({ id })) };
};

/** A clock that advances by the next value of `steps` on each reading pair. */
function fakeClock(durations: number[]) {
  let now = 0;
  let reading = 0;
  return () => {
    const value = now;
    if (reading++ % 2 === 0) now += durations[Math.floor((reading - 1) / 2)]!;
    return value;
  };
}

const INFO = { date: "2026-10-02", release: "7", model: "embed-v4.0", threshold: 0.35, translatedLeg: true };

describe("running and measuring", () => {
  it("asks each question once, in order, and times it", async () => {
    const asked: string[] = [];
    const results = await runQuestions(QUESTIONS, async (input) => {
      asked.push(`${input.lang}:${input.q}`);
      return fake(input);
    }, fakeClock([10, 20, 30, 40, 50, 60, 70]));
    expect(asked).toHaveLength(7);
    expect(asked[0]).toBe("en:question en-1");
    expect(results.map((r) => r.ms)).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it("reports the subsets separately, per language and overall", async () => {
    const results = await runQuestions(QUESTIONS, fake, fakeClock([10, 20, 30, 40, 50, 60, 70]));
    const report = buildReport(results, INFO, ["tuning", "evaluation"]);

    expect(TestSetReportSchema.safeParse(report).success).toBe(true);
    expect(report).toMatchObject({ v: 1, date: "2026-10-02", release: "7", model: "embed-v4.0", threshold: 0.35, translated_leg: true, question_count: 7 });

    const tuning = report.subsets.tuning!;
    // top 3 over the questions that are not no_match: en-1 hit, en-2 miss (rank 4), en-3 hit, ur-1 miss
    expect(tuning.overall.top3).toEqual({ hits: 2, of: 4, rate: 0.5 });
    expect(tuning.overall.top5).toEqual({ hits: 3, of: 4, rate: 0.75 });
    expect(tuning.overall.no_match).toEqual({ hits: 1, of: 2, rate: 0.5 });
    expect(tuning.overall.emergency).toEqual({ hits: 1, of: 1, rate: 1 });
    expect(tuning.overall.questions).toBe(6);
    expect(tuning.overall.results_returned).toEqual({ total: 11, mean: 1.83 });
    expect(tuning.overall.time_ms).toEqual({ p50: 30, p95: 60 });
    expect(Object.keys(tuning.by_language)).toEqual(["en", "fr", "ur"]);
    expect(tuning.by_language.en!.top3).toEqual({ hits: 2, of: 3, rate: 0.6667 });
    expect(tuning.by_language.ur!.top3).toEqual({ hits: 0, of: 1, rate: 0 });
    expect(tuning.by_language.ur!.no_match).toEqual({ hits: 0, of: 1, rate: 0 });
    expect(tuning.by_language.fr!.top3).toEqual({ hits: 0, of: 0, rate: null });
    expect(tuning.by_language.fr!.no_match).toEqual({ hits: 1, of: 1, rate: 1 });

    const evaluation = report.subsets.evaluation!;
    expect(evaluation.overall.questions).toBe(1);
    expect(evaluation.overall.top3).toEqual({ hits: 1, of: 1, rate: 1 });
    expect(Object.keys(evaluation.by_language)).toEqual(["fr"]);
  });

  it("leaves a subset that was not run null", async () => {
    const results = await runQuestions(QUESTIONS.filter((x) => x.split === "tuning"), fake);
    expect(buildReport(results, INFO, ["tuning"]).subsets.evaluation).toBeNull();
  });

  it("takes nearest-rank percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 50)).toBe(50);
    expect(percentile(hundred, 95)).toBe(95);
    expect(percentile([30, 10, 20], 50)).toBe(20);
  });

  it("names the file {date}-{model}.json", () => {
    expect(reportFileName("2026-10-02", "embed-v4.0")).toBe("2026-10-02-embed-v4.0.json");
    expect(reportFileName("2026-10-02", "a/b c")).toBe("2026-10-02-a-b-c.json");
  });
});

describe("comparing two reports", () => {
  it("shows per-language differences and lists every language that got worse", async () => {
    const run = async (answers: Record<string, string[]>) =>
      buildReport(
        await runQuestions(QUESTIONS, async ({ q: text }) => ({ status: "ok", emergency_first: true, results: (answers[text] ?? []).map((id) => ({ id })) })),
        INFO,
        ["tuning", "evaluation"],
      );
    const a = await run({ "question en-1": ["M008"], "question ur-1": ["M001"], "question fr-2": ["M022"] });
    const b = await run({ "question en-1": ["M008"], "question ur-1": ["M008"], "question fr-2": ["M001"] });

    const { lines, worse } = compareReports(a, b);

    expect(worse).toEqual(["evaluation fr top 3: 100.0% -> 0.0%", "evaluation fr top 5: 100.0% -> 0.0%", "evaluation overall top 3: 100.0% -> 0.0%", "evaluation overall top 5: 100.0% -> 0.0%"]);
    const text = lines.join("\n");
    expect(text).toMatch(/ur\s+0->100 \(\+100\)/);
    expect(text).toMatch(/fr\s+100->0 \(-100\) WORSE/);
    expect(text).toContain("Worse (4):");
  });

  it("says so when nothing got worse", async () => {
    const report = buildReport(await runQuestions(QUESTIONS, fake), INFO, ["tuning", "evaluation"]);
    const { lines, worse } = compareReports(report, report);
    expect(worse).toEqual([]);
    expect(lines.at(-1)).toBe("No language got worse.");
  });
});

// --- the command line ----------------------------------------------------------------------------

function cli(args: string[]) {
  const result = spawnSync("node", [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

describe("scripts/search-test-set", () => {
  it("validate passes on the committed set and reports the questions nobody has checked yet", () => {
    const { code, out } = cli(["validate"]);
    expect(code).toBe(0);
    expect(out).toContain("32 questions, all valid");
    expect(out).toContain("not yet checked by a second team member");
  });

  it("validate --require-checked fails while a question is unchecked", () => {
    expect(cli(["validate", "--require-checked"]).code).toBe(1);
  });

  it("run writes data/.../reports/{date}-{model}.json and compare reads it back", () => {
    const dir = tempDir();
    const engine = path.join(dir, "engine.mjs");
    // Finds the provider whose id the question's text was written for: a stand-in that always answers with M008.
    writeFileSync(engine, `export default async ({ q }) => ({ status: "ok", emergency_first: q.includes("fire"), results: [{ id: "M008" }, { id: "M071" }] });\n`);
    const common = ["--engine", engine, "--release", "3", "--threshold", "0.4", "--out-dir", dir, "--date", "2026-10-02"];

    const first = cli(["run", ...common, "--model", "model-a", "--translated-leg", "off"]);
    expect(first.code, first.err).toBe(0);
    expect(first.out).toContain("tuning subset");
    expect(first.out).toContain("evaluation subset");
    expect(readdirSync(dir)).toContain("2026-10-02-model-a.json");
    const report = TestSetReportSchema.parse(JSON.parse(readFileSync(path.join(dir, "2026-10-02-model-a.json"), "utf8")));
    expect(report).toMatchObject({ release: "3", model: "model-a", threshold: 0.4, translated_leg: false, question_count: 32 });
    expect(report.subsets.tuning!.overall.questions + report.subsets.evaluation!.overall.questions).toBe(32);

    expect(cli(["run", ...common, "--model", "model-a", "--translated-leg", "off"]).code).toBe(1); // will not overwrite
    const tuningOnly = cli(["run", ...common, "--model", "model-b", "--translated-leg", "on", "--split", "tuning"]);
    expect(tuningOnly.code, tuningOnly.err).toBe(0);
    expect(tuningOnly.out).toContain("evaluation subset: not run");

    const compared = cli(["--compare", path.join(dir, "2026-10-02-model-a.json"), path.join(dir, "2026-10-02-model-a.json")]);
    expect(compared.code).toBe(0);
    expect(compared.out).toContain("No language got worse.");
  });

  it("run needs its options, and compare needs two readable reports", () => {
    expect(cli(["run"]).code).toBe(2);
    expect(cli(["--compare", "only-one"]).code).toBe(2);
    expect(cli(["--compare", "missing-a.json", "missing-b.json"]).code).toBe(1);
    expect(cli([]).code).toBe(2);
  });
});
