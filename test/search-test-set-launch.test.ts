// The full test set and the launch bar (S03.08): importing the ambassadors' sheet, coverage, the seeded evaluation split,
// bar.json and launch readiness. No search is run here.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Metrics, TestQuestion, TestSetReport } from "@/contracts/searchTestSet";
import { BarSchema, LAUNCH_LANGS, SubsetsFileSchema, type Bar } from "@/contracts/searchTestSetLaunch";
import { formatBarResult, latestEvaluationReport, launchReadiness, meetsBar, readBar } from "../scripts/search-test-set/bar";
import { importRows, parseCsv, personalDataIn, questionLine, splitProviderIds, TEMPLATE_COLUMNS } from "../scripts/search-test-set/importSheet";
import { parseQuestions, providerIdsOf } from "../scripts/search-test-set/lib";
import { main } from "../scripts/search-test-set/main";
import { assignSubsets, checkCoverage, checkSubsets, DEFAULT_SEED, formatCoverage } from "../scripts/search-test-set/subsets";

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data", "search-test-set");
const IDS = providerIdsOf(readFileSync(path.join(ROOT, "data", "catalogue", "providers.json"), "utf8"));
const REAL_TEXT = readFileSync(path.join(DATA, "questions.jsonl"), "utf8");
const REAL = parseQuestions(REAL_TEXT, IDS).questions;
const temp: string[] = [];
const ENV = {} as NodeJS.ProcessEnv;

afterAll(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

const HEADER = TEMPLATE_COLUMNS.join(",");
type Cells = Partial<Record<(typeof TEMPLATE_COLUMNS)[number], string>>;
const sheetRow = (cells: Cells = {}) => {
  const row: Cells = { lang: "en", question: "Where is a food bank open on Sunday?", form: "native", intent: "normal", expected: "M008", author: "ab", added: "2026-10-20", ...cells };
  return TEMPLATE_COLUMNS.map((column) => {
    const value = row[column] ?? "";
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(",");
};
const sheet = (...rows: string[]) => parseCsv([HEADER, ...rows].join("\n"));

const question = (id: string, changes: Partial<TestQuestion> = {}): TestQuestion => ({
  id,
  lang: "en",
  q: `question ${id}`,
  form: "native",
  intent: "normal",
  expected: ["M008"],
  split: "tuning",
  author: "ab",
  added: "2026-10-20",
  checked_by: null,
  checked_on: null,
  ...changes,
});

describe("reading the sheet as CSV", () => {
  it("reads quoted cells with commas, quotes and line breaks, a byte-order mark and CRLF line ends", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"\nthere']]);
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("reads provider ids separated by spaces, commas or semicolons, in any case", () => {
    expect(splitProviderIds(" m008, M071;M007  M010 ")).toEqual(["M008", "M071", "M007", "M010"]);
    expect(splitProviderIds("")).toEqual([]);
  });

  it("ships a template whose header is the import's columns, with only a skipped example row", () => {
    const rows = parseCsv(readFileSync(path.join(DATA, "template.csv"), "utf8"));
    expect(rows[0]).toEqual([...TEMPLATE_COLUMNS]);
    const result = importRows(rows, REAL, IDS);
    expect(result).toEqual({ accepted: [], refused: [], missingExpected: [], sheetErrors: [] });
  });
});

describe("personal data in a question", () => {
  it("finds phone numbers, in ASCII and in other scripts' digits", () => {
    expect(personalDataIn("call me at 416-555-0199")).toEqual(["a phone number"]);
    expect(personalDataIn("my number is (647) 555 0199 please")).toEqual(["a phone number"]);
    expect(personalDataIn("+1 416 555 0199")).toEqual(["a phone number"]);
    expect(personalDataIn("میرا نمبر ۴۱۶۵۵۵۰۱۹۹ ہے")).toEqual(["a phone number"]); // Extended Arabic-Indic
    expect(personalDataIn("رقمي ٤١٦٥٥٥٠١٩٩")).toEqual(["a phone number"]); // Arabic-Indic
    expect(personalDataIn("मेरा नंबर ४१६-५५५-०१९९")).toEqual(["a phone number"]); // Devanagari
    expect(personalDataIn("４１６５５５０１９９")).toEqual(["a phone number"]); // full-width
  });

  it("finds email addresses", () => {
    expect(personalDataIn("write to amina.k@example.com")).toEqual(["an email address"]);
  });

  it("finds unit and apartment numbers", () => {
    for (const text of ["I live in unit 1205", "apt. 3B has no heat", "Apartment #12 water leak", "suite 400", "flat no. 7", "room 12", "help at #1205", "1205-20 Overlea Blvd no heat", "फ्लैट 12 में पानी नहीं", "فلیٹ ۱۲ میں بجلی نہیں", "byt 15 nemá teplo", "appartement 9 sans chauffage"]) {
      expect(personalDataIn(text), text).toEqual(["a unit or apartment number"]);
    }
  });

  it("does not flag ordinary questions, 911 or small numbers", () => {
    for (const text of ["need halal daycare for my 2 yr old", "call 9-1-1 now", "is the clinic open 9 to 5", "between 2-3 days", "free food for 4 people", "community centre near 20 Overlea", "united way help", "roommate problem"]) {
      expect(personalDataIn(text), text).toEqual([]);
    }
  });

  it("finds none in the committed set", () => {
    for (const q of REAL) expect(personalDataIn(q.q), q.id).toEqual([]);
  });
});

describe("importing rows", () => {
  it("accepts a valid row and numbers it after the ids already taken", () => {
    const result = importRows(sheet(sheetRow(), sheetRow({ lang: "ur", question: "khana kahan milega", form: "romanized" })), [question("en-01"), question("en-02")], IDS);
    expect(result.refused).toEqual([]);
    expect(result.accepted.map((q) => [q.id, q.row])).toEqual([["en-03", 2], ["ur-01", 3]]);
    expect(result.accepted[0]).toMatchObject({ lang: "en", q: "Where is a food bank open on Sunday?", expected: ["M008"], checked_by: null, checked_on: null });
    expect(result.accepted[0]).not.toHaveProperty("split");
  });

  it("keeps a given id and the page language", () => {
    const result = importRows(sheet(sheetRow({ id: "en-amb-01", page_lang: "ur", checked_by: "cd", checked_on: "2026-10-21" })), [], IDS);
    expect(result.accepted[0]).toMatchObject({ id: "en-amb-01", page_lang: "ur", checked_by: "cd", checked_on: "2026-10-21" });
  });

  it("accepts a no_match row with no expected provider, and refuses one with a provider", () => {
    expect(importRows(sheet(sheetRow({ intent: "no_match", expected: "" })), [], IDS).accepted).toHaveLength(1);
    const refused = importRows(sheet(sheetRow({ intent: "no_match", expected: "M008" })), [], IDS);
    expect(refused.refused).toEqual([{ row: 2, reasons: ["expected: must be empty for a no_match question"] }]);
  });

  it("refuses and lists every other row without an expected provider", () => {
    const result = importRows(sheet(sheetRow({ expected: "" }), sheetRow({ question: "fire in the building", intent: "emergency", expected: " " })), [], IDS);
    expect(result.accepted).toEqual([]);
    expect(result.missingExpected).toEqual([2, 3]);
    expect(result.refused[0]!.reasons).toEqual(["has no expected provider: every normal question but no_match needs one or more provider ids"]);
    expect(result.refused[1]!.reasons).toEqual(["has no expected provider: every emergency question but no_match needs one or more provider ids"]);
  });

  it("refuses personal data, unknown providers, repeated ids and texts, and schema failures, naming the row", () => {
    const existing = [question("en-01", { q: "Where is a food bank open on Sunday?" })];
    const result = importRows(
      sheet(
        sheetRow({ question: "my phone 416 555 0199 call me" }),
        sheetRow({ question: "need a doctor", expected: "M999" }),
        sheetRow({ id: "en-01", question: "need a dentist" }),
        sheetRow(),
        sheetRow({ question: "need a lawyer", form: "spoken", author: "Amina Khan" }),
      ),
      existing,
      IDS,
    );
    expect(result.accepted).toEqual([]);
    expect(result.refused.map((r) => r.row)).toEqual([2, 3, 4, 5, 6]);
    expect(result.refused[0]!.reasons).toEqual(["holds a phone number: write the question without it"]);
    expect(result.refused[1]!.reasons).toEqual(["expected: provider id M999 is not in data/catalogue/providers.json"]);
    expect(result.refused[2]!.reasons).toEqual(["id: en-01 is already used"]);
    expect(result.refused[3]!.reasons).toEqual(["question: the same text is already en-01 in the set"]);
    expect(result.refused[4]!.reasons.join(" | ")).toMatch(/form: .*author: must be initials/);
  });

  it("refuses a text repeated within the sheet", () => {
    const result = importRows(sheet(sheetRow(), sheetRow()), [], IDS);
    expect(result.accepted).toHaveLength(1);
    expect(result.refused).toEqual([{ row: 3, reasons: ["question: the same text is already row 2 of the sheet"] }]);
  });

  it("skips empty rows and rows starting with #", () => {
    const result = importRows(sheet(",,,,", "# example,en,,x,native,normal,M008,ab,2026-10-20,,", sheetRow()), [], IDS);
    expect(result.accepted.map((q) => q.row)).toEqual([4]);
  });

  it("refuses a sheet without a required column, or with a column the template does not have", () => {
    expect(importRows(parseCsv("lang,question\nen,x"), [], IDS).sheetErrors.length).toBeGreaterThan(0);
    const notes = importRows(parseCsv(`${HEADER},notes\n`), [], IDS);
    expect(notes.sheetErrors).toEqual([expect.stringContaining("notes")]);
  });

  it("writes lines in the questions file's own style", () => {
    for (const raw of REAL_TEXT.split("\n").filter((l) => l.trim() !== "")) {
      expect(questionLine(JSON.parse(raw) as TestQuestion)).toBe(raw);
    }
  });
});

describe("coverage", () => {
  const full = (): TestQuestion[] => {
    const set: TestQuestion[] = [];
    for (const lang of LAUNCH_LANGS) {
      for (let n = 1; n <= 10; n += 1) {
        const intent = n === 1 ? "emergency" : n === 2 ? "no_match" : "normal";
        set.push(question(`${lang}-${n}`, { lang, intent, expected: intent === "no_match" ? [] : ["M008"], split: n <= 4 ? "evaluation" : "tuning" }));
      }
    }
    for (let n = 1; n <= 5; n += 1) set.find((q) => q.id === `ur-${n + 4}`)!.form = "romanized";
    for (let n = 1; n <= 3; n += 1) set.find((q) => q.id === `hi-${n + 4}`)!.form = "mixed";
    return set;
  };

  it("is met by a set with every minimum", () => {
    expect(checkCoverage(full())).toMatchObject({ gaps: [], evaluationGaps: [] });
    expect(formatCoverage(checkCoverage(full()))[0]).toMatch(/Launch readiness \(coverage\): met$/);
  });

  it("names each gap", () => {
    const set = full().filter((q) => q.id !== "ta-10" && q.id !== "ur-5" && q.id !== "hi-5");
    const coverage = checkCoverage(set);
    expect(coverage.gaps).toEqual([
      { name: "ur questions", have: 9, need: 10 },
      { name: "ta questions", have: 9, need: 10 },
      { name: "hi questions", have: 9, need: 10 },
      { name: "romanized Urdu questions (ur, romanized)", have: 4, need: 5 },
      { name: "Hinglish questions (hi, mixed)", have: 2, need: 3 },
    ]);
    const fewer = full().map((q) => (q.id === "fr-1" || q.id === "fr-2" ? { ...q, split: "tuning" as const } : q));
    expect(checkCoverage(fewer).evaluationGaps).toEqual([
      { name: "evaluation subset: fr questions", have: 2, need: 4 },
    ]);
    expect(formatCoverage(coverage)).toContain("  gap: ta questions: 9 of 10");
  });

  it("does not count machine drafts", () => {
    const set = full().map((q) => (q.lang === "el" ? { ...q, author: "claude-draft" } : q));
    expect(checkCoverage(set).gaps).toContainEqual({ name: "el questions", have: 0, need: 10 });
  });
});

describe("the evaluation split", () => {
  const set = (count: number, changes: (n: number) => Partial<TestQuestion> = () => ({})) => Array.from({ length: count }, (_, n) => question(`en-${n + 1}`, changes(n)));

  it("is the same every time for the same set and seed, whatever the file's order", () => {
    const questions = [...set(10), ...set(10, () => ({ lang: "ur" })).map((q) => ({ ...q, id: q.id.replace("en", "ur") }))];
    const a = assignSubsets(questions, null, 7);
    const b = assignSubsets([...questions].reverse(), null, 7);
    expect(a.file).toEqual(b.file);
    expect(SubsetsFileSchema.parse(a.file)).toEqual(a.file);
    expect(a.file.evaluation).toEqual([...a.file.evaluation].sort());
    expect(a.file.evaluation.filter((id) => id.startsWith("en-"))).toHaveLength(4);
    expect(a.file.evaluation.filter((id) => id.startsWith("ur-"))).toHaveLength(4);
    expect(assignSubsets(questions, null, 8).file.evaluation).not.toEqual(a.file.evaluation);
  });

  it("puts 4 emergency and 4 no_match questions in evaluation before filling languages", () => {
    const questions = set(30, (n) => (n < 6 ? { intent: "emergency" } : n < 12 ? { intent: "no_match", expected: [] } : {}));
    const { file } = assignSubsets(questions, null, 1);
    const inEval = questions.filter((q) => file.evaluation.includes(q.id));
    expect(inEval.filter((q) => q.intent === "emergency")).toHaveLength(4);
    expect(inEval.filter((q) => q.intent === "no_match")).toHaveLength(4);
    expect(inEval).toHaveLength(8); // en already has 4 or more
  });

  it("never puts a machine draft in evaluation", () => {
    const questions = set(10, (n) => (n < 8 ? { author: "claude-draft" } : {}));
    const { file } = assignSubsets(questions, null, 1);
    expect(file.evaluation).toEqual(["en-10", "en-9"]);
  });

  it("assigns new questions without moving existing ones, and drops removed ones", () => {
    const first = assignSubsets(set(6), null, 3).file;
    expect(first.evaluation).toHaveLength(4);
    const grown = [...set(12).filter((q) => q.id !== "en-1")];
    const next = assignSubsets(grown, first);
    for (const id of first.evaluation.filter((x) => x !== "en-1")) expect(next.file.evaluation).toContain(id);
    for (const id of first.tuning.filter((x) => x !== "en-1")) expect(next.file.tuning).toContain(id);
    expect(next.removed).toEqual(first.evaluation.includes("en-1") || first.tuning.includes("en-1") ? ["en-1"] : []);
    expect(next.evaluation.length).toBe(first.evaluation.includes("en-1") ? 1 : 0); // tops en back up to 4
    expect(assignSubsets(grown, next.file).file).toEqual(next.file);
  });

  it("refuses a different seed than the committed file's", () => {
    expect(() => assignSubsets(set(2), { seed: 1, evaluation: [], tuning: [] }, 2)).toThrow(/seed/);
  });

  it("reports where questions.jsonl and subsets.json disagree", () => {
    const questions = [question("a-1", { split: "evaluation" }), question("a-2"), question("a-3", { author: "claude-draft", split: "evaluation" })];
    expect(checkSubsets(questions, { seed: 1, evaluation: ["a-3"], tuning: ["a-1", "gone"] })).toEqual([
      "a-1 has split evaluation in questions.jsonl but is in tuning in data/search-test-set/subsets.json",
      "a-2 is not in data/search-test-set/subsets.json: run `npm run search-test-set -- assign`",
      "a-3 is a claude-draft question in the evaluation subset",
      "gone is in data/search-test-set/subsets.json but not in questions.jsonl",
    ]);
  });

  it("is committed, with the committed seed, and agrees with questions.jsonl", () => {
    const file = SubsetsFileSchema.parse(JSON.parse(readFileSync(path.join(DATA, "subsets.json"), "utf8")));
    expect(file.seed).toBe(DEFAULT_SEED);
    expect(checkSubsets(REAL, file)).toEqual([]);
    expect(assignSubsets(REAL, file).file).toEqual(file); // nothing left to assign
  });
});

// --- the launch bar --------------------------------------------------------------------------------

const rate = (r: number | null, of = 10) => ({ hits: r === null ? 0 : Math.round(r * of), of: r === null ? 0 : of, rate: r });
const metrics = (top3: number | null, noMatch: number | null = null, emergency: number | null = null): Metrics => ({
  questions: 10,
  top3: rate(top3),
  top5: rate(top3),
  no_match: rate(noMatch),
  emergency: rate(emergency),
  false_emergency_rate: rate(0),
  error_count: 0,
  unavailable_count: 0,
  results_returned: { total: 30, mean: 3 },
  time_ms: { p50: 100, p95: 200 },
});
const report = (evaluation: boolean, byLanguage: Record<string, number | null> = { en: 0.9, ur: 0.7 }, date = "2026-11-01"): TestSetReport => ({
  v: 2,
  date,
  release: "12",
  model: "embed-v4.0",
  threshold: 0.4,
  translated_leg: true,
  question_count: 40,
  questions_sha256: "0".repeat(64),
  unchecked_count: 0,
  subsets: {
    tuning: null,
    evaluation: evaluation
      ? { overall: metrics(0.8, 0.9, 1), by_language: Object.fromEntries(Object.entries(byLanguage).map(([lang, r]) => [lang, metrics(r)])), by_language_kind: {}, expected_not_in_release: { checked: true, ids: [], question_ids: [] }, rows: [] }
      : null,
  },
});
const approved = (hitRate: Record<string, number>, noMatch = 0.8, emergency = 0.95): Bar => ({
  version: 1,
  approvedBy: "Hub Director",
  approvedOn: "2026-11-02",
  minimums: { hitRate: Object.fromEntries(LAUNCH_LANGS.map((lang) => [lang, hitRate[lang] ?? 0])), noMatchAccuracy: noMatch, emergencyAccuracy: emergency },
});

describe("bar.json", () => {
  it("is committed unapproved, with no minimums set", () => {
    const bar = readBar(ROOT);
    expect(bar).toEqual({ version: 1, approvedBy: null, approvedOn: null, minimums: { hitRate: {}, noMatchAccuracy: 0, emergencyAccuracy: 0 } });
  });

  it("has exactly the agreed shape", () => {
    expect(BarSchema.safeParse(approved({})).success).toBe(true);
    expect(BarSchema.safeParse({ ...approved({}), extra: 1 }).success).toBe(false);
    expect(BarSchema.safeParse({ ...approved({}), version: 2 }).success).toBe(false);
    expect(BarSchema.safeParse({ ...approved({}), approvedOn: null }).success).toBe(false);
    expect(BarSchema.safeParse({ ...approved({}), approvedOn: "2 Nov 2026" }).success).toBe(false);
    expect(BarSchema.safeParse({ ...approved({}), minimums: { ...approved({}).minimums, noMatchAccuracy: 1.2 } }).success).toBe(false);
    expect(BarSchema.safeParse({ ...approved({}), minimums: { ...approved({}).minimums, hitRate: { en: 0.8 } } }).success).toBe(false); // approved: every language
    expect(BarSchema.safeParse({ version: 1, approvedBy: null, approvedOn: null, minimums: { hitRate: { xx: 0.5 }, noMatchAccuracy: 0, emergencyAccuracy: 0 } }).success).toBe(false);
  });
});

describe("meetsBar", () => {
  it("passes every measure at or above its minimum", () => {
    const result = meetsBar(report(true, Object.fromEntries(LAUNCH_LANGS.map((l) => [l, 0.8]))), approved({ en: 0.8 }));
    expect(result.met).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.measures).toContainEqual({ measure: "hitRate", lang: "en", name: "hit rate (en)", minimum: 0.8, actual: 0.8, pass: true, drop: 0 });
    expect(result.measures.at(-2)).toEqual({ measure: "noMatchAccuracy", lang: null, name: "no-match accuracy", minimum: 0.8, actual: 0.9, pass: true, drop: 0 });
    expect(result.measures.at(-1)).toEqual({ measure: "emergencyAccuracy", lang: null, name: "emergency accuracy", minimum: 0.95, actual: 1, pass: true, drop: 0 });
  });

  it("fails a measure below its minimum and gives the drop", () => {
    const all = Object.fromEntries(LAUNCH_LANGS.map((l) => [l, 0.9]));
    const result = meetsBar(report(true, { ...all, ur: 0.65 }), approved({ ur: 0.8 }, 0.95));
    expect(result.met).toBe(false);
    expect(result.measures.filter((m) => !m.pass)).toEqual([
      { measure: "hitRate", lang: "ur", name: "hit rate (ur)", minimum: 0.8, actual: 0.65, pass: false, drop: 0.15 },
      { measure: "noMatchAccuracy", lang: null, name: "no-match accuracy", minimum: 0.95, actual: 0.9, pass: false, drop: 0.05 },
    ]);
    expect(formatBarResult(result)).toContain("  hit rate (ur): 65.0% against a minimum of 80.0%: FAIL (15.0 points below)");
  });

  it("fails a language the evaluation subset did not measure", () => {
    const result = meetsBar(report(true, { en: 0.9 }), approved({}));
    expect(result.met).toBe(false);
    expect(result.measures.find((m) => m.lang === "ps")).toEqual({ measure: "hitRate", lang: "ps", name: "hit rate (ps)", minimum: 0, actual: null, pass: false, drop: null });
  });

  it("is never met by an unapproved bar or a report without the evaluation subset", () => {
    const all = Object.fromEntries(LAUNCH_LANGS.map((l) => [l, 1]));
    const unapproved = meetsBar(report(true, all), readBar(ROOT));
    expect(unapproved).toMatchObject({ met: false, approved: false });
    expect(unapproved.measures.every((m) => m.pass)).toBe(true);
    expect(unapproved.problems).toEqual([expect.stringContaining("not approved")]);
    const tuningOnly = meetsBar(report(false), approved({}));
    expect(tuningOnly.met).toBe(false);
    expect(tuningOnly.problems).toEqual([expect.stringContaining("did not run the evaluation subset")]);
  });
});

describe("launch readiness", () => {
  const repo = (bar: Bar, reports: Record<string, unknown>) => {
    const dir = mkdtempSync(path.join(tmpdir(), "cvh-launch-"));
    temp.push(dir);
    mkdirSync(path.join(dir, "data", "search-test-set", "reports"), { recursive: true });
    writeFileSync(path.join(dir, "data", "search-test-set", "bar.json"), JSON.stringify(bar));
    for (const [name, body] of Object.entries(reports)) writeFileSync(path.join(dir, "data", "search-test-set", "reports", name), typeof body === "string" ? body : JSON.stringify(body));
    return dir;
  };
  const all = (r: number) => Object.fromEntries(LAUNCH_LANGS.map((l) => [l, r]));

  it("reads the latest report that ran the evaluation subset, skipping others", () => {
    const dir = repo(approved({}), {
      "2026-11-01-a.json": report(true, all(0.5), "2026-11-01"),
      "2026-11-03-b.json": report(true, all(0.9), "2026-11-03"),
      "2026-11-05-c.json": report(false, {}, "2026-11-05"),
      "2026-11-06-summary.json": { v: 1, something: "else" },
      "broken.json": "{",
    });
    expect(latestEvaluationReport(dir)?.file).toBe(path.join("data", "search-test-set", "reports", "2026-11-03-b.json"));
  });

  it("is met only when the latest evaluation report meets every minimum of an approved bar", () => {
    expect(launchReadiness(repo(approved(all(0.8)), { "r.json": report(true, all(0.9)) })).met).toBe(true);
    const below = launchReadiness(repo(approved(all(0.8)), { "a.json": report(true, all(0.9), "2026-11-01"), "b.json": report(true, all(0.7), "2026-11-02") }));
    expect(below.met).toBe(false);
    expect(below.lines[0]).toMatch(/^Search launch readiness: not met/);
  });

  it("is not met in the repository today: no evaluation report and an unapproved bar", () => {
    const result = launchReadiness(ROOT);
    expect(result.met).toBe(false);
    expect(result.lines).toContain("  the launch bar is not approved yet (data/search-test-set/bar.json has no approvedBy)");
  });
});

// --- the committed set's coverage: a status until launch -------------------------------------------
//
// The full set is written with ambassadors before launch (S03.08). Until then the committed set has gaps, so CI prints them as
// "Launch readiness (coverage): not met" and stays green. Set SEARCH_TEST_SET_LAUNCH=1 (launch mode) and any gap fails.
describe("the committed set's launch coverage", () => {
  const coverage = checkCoverage(REAL);
  const launchMode = process.env.SEARCH_TEST_SET_LAUNCH === "1";

  it("reports its status and every gap by name", () => {
    const lines = formatCoverage(coverage);
    console.log(lines.join("\n"));
    expect(lines[0]).toMatch(/Launch readiness \(coverage\): (met|not met)$/);
    expect(lines.length - 1).toBe(coverage.gaps.length + coverage.evaluationGaps.length);
  });

  it.runIf(launchMode)("has no gap (launch mode, SEARCH_TEST_SET_LAUNCH=1)", () => {
    expect([...coverage.gaps, ...coverage.evaluationGaps]).toEqual([]);
  });
});

// --- the command line ------------------------------------------------------------------------------

describe("the command line", () => {
  let dir: string;
  let out: string[];
  let err: string[];
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "cvh-import-"));
    temp.push(dir);
    mkdirSync(path.join(dir, "data", "catalogue"), { recursive: true });
    mkdirSync(path.join(dir, "data", "search-test-set", "reports"), { recursive: true });
    copyFileSync(path.join(ROOT, "data", "catalogue", "providers.json"), path.join(dir, "data", "catalogue", "providers.json"));
    for (const file of ["questions.jsonl", "subsets.json", "bar.json"]) copyFileSync(path.join(DATA, file), path.join(dir, "data", "search-test-set", file));
    out = [];
    err = [];
    vi.spyOn(console, "log").mockImplementation((...args) => void out.push(args.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args) => void err.push(args.join(" ")));
  });
  afterEach(() => vi.restoreAllMocks());
  const read = (file: string) => readFileSync(path.join(dir, "data", "search-test-set", file), "utf8");
  const writeSheet = (...rows: string[]) => {
    const file = path.join(dir, "sheet.csv");
    writeFileSync(file, [HEADER, ...rows].join("\r\n"));
    return file;
  };

  it("imports a sheet, assigns the new questions by the seed and validates", async () => {
    const rows = LAUNCH_LANGS.slice(0, 2).flatMap((lang) =>
      [1, 2, 3, 4, 5].map((n) => sheetRow({ lang, question: `ambassador question ${lang} ${n}`, intent: n === 5 ? "no_match" : "normal", expected: n === 5 ? "" : "M008" })),
    );
    const before = read("questions.jsonl");
    expect(await main(["import", writeSheet(...rows)], ENV, dir)).toBe(0);
    const after = read("questions.jsonl");
    expect(after.startsWith(before)).toBe(true);
    const added = after.slice(before.length).trim().split("\n").map((l) => JSON.parse(l) as TestQuestion);
    expect(added.map((q) => q.id)).toEqual(["en-11", "en-12", "en-13", "en-14", "en-15", "ur-15", "ur-16", "ur-17", "ur-18", "ur-19"]);
    const subsets = SubsetsFileSchema.parse(JSON.parse(read("subsets.json")));
    expect(added.filter((q) => q.split === "evaluation").map((q) => q.id).sort()).toEqual(subsets.evaluation.filter((id) => added.some((q) => q.id === id)));
    expect(added.filter((q) => q.lang === "en" && q.split === "evaluation").length).toBeGreaterThanOrEqual(3); // en had 1
    expect(await main(["validate"], ENV, dir)).toBe(0);
    // Assigning again moves nothing.
    const file = read("subsets.json");
    expect(await main(["assign"], ENV, dir)).toBe(0);
    expect(read("subsets.json")).toBe(file);
  });

  it("writes nothing when a row is refused, unless --skip-refused", async () => {
    const sheetFile = writeSheet(sheetRow({ question: "ambassador question one" }), sheetRow({ question: "email me at a@b.co" }), sheetRow({ question: "where is help", expected: "" }));
    const before = read("questions.jsonl");
    expect(await main(["import", sheetFile], ENV, dir)).toBe(1);
    expect(read("questions.jsonl")).toBe(before);
    expect(err).toContain(`${sheetFile}: row 3: holds an email address: write the question without it`);
    expect(err).toContain("Rows missing an expected provider: 4");
    expect(await main(["import", sheetFile, "--dry-run"], ENV, dir)).toBe(1);
    expect(read("questions.jsonl")).toBe(before);
    expect(await main(["import", sheetFile, "--skip-refused"], ENV, dir)).toBe(1);
    expect(read("questions.jsonl")).not.toBe(before);
    expect(await main(["validate"], ENV, dir)).toBe(0);
  });

  it("refuses an .xlsx with advice to save it as CSV", async () => {
    expect(await main(["import", "sheet.xlsx"], ENV, dir)).toBe(2);
    expect(err.join("\n")).toMatch(/CSV UTF-8/);
  });

  it("validate fails when questions.jsonl and subsets.json disagree", async () => {
    writeFileSync(path.join(dir, "data", "search-test-set", "questions.jsonl"), read("questions.jsonl").replace('"id": "en-01", "lang": "en", "q": "Where can I get free food for my family?", "form": "native", "intent": "normal", "expected": ["M008", "M071", "M007"], "split": "tuning"', '"id": "en-01", "lang": "en", "q": "Where can I get free food for my family?", "form": "native", "intent": "normal", "expected": ["M008", "M071", "M007"], "split": "evaluation"'));
    expect(await main(["validate"], ENV, dir)).toBe(1);
    expect(err).toContain("en-01 has split evaluation in questions.jsonl but is in tuning in data/search-test-set/subsets.json");
  });

  it("coverage exits 0 with the gaps, and 1 in launch mode", async () => {
    expect(await main(["coverage"], ENV, dir)).toBe(0);
    expect(out[0]).toMatch(/Launch readiness \(coverage\): not met/);
    expect(out).toContain("  gap: en questions: 2 of 10");
    expect(await main(["coverage", "--launch"], ENV, dir)).toBe(1);
    expect(await main(["coverage"], { ...ENV, SEARCH_TEST_SET_LAUNCH: "1" }, dir)).toBe(1);
  });

  it("readiness exits 1 until an approved bar is met", async () => {
    expect(await main(["readiness"], ENV, dir)).toBe(1);
    expect(out[0]).toBe("Search launch readiness: not met");
    writeFileSync(path.join(dir, "data", "search-test-set", "bar.json"), JSON.stringify(approved(Object.fromEntries(LAUNCH_LANGS.map((l) => [l, 0.5])))));
    writeFileSync(path.join(dir, "data", "search-test-set", "reports", "r.json"), JSON.stringify(report(true, Object.fromEntries(LAUNCH_LANGS.map((l) => [l, 0.6])))));
    expect(await main(["readiness"], ENV, dir)).toBe(0);
  });

  it("assign --adopt-splits refuses when subsets.json exists", async () => {
    expect(await main(["assign", "--adopt-splits"], ENV, dir)).toBe(1);
  });
});
