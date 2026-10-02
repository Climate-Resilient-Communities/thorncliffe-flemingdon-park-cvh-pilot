// The search test set (S03.01): the question format, the committed starter set, the runner against a
// fake engine, the report and the comparison, and the command line.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LANG_CODES } from "@/contracts/lang";
import { SearchV1Schema, TestSetReportSchema, TestQuestionSchema, type TestQuestion } from "@/contracts/searchTestSet";
import {
  buildReport,
  compareReports,
  formatLineErrors,
  parseQuestions,
  percentile,
  providerIdsOf,
  reportFileName,
  runQuestions,
  torontoDate,
  type EngineInput,
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
  form: "native",
  intent: "normal",
  expected: ["M008"],
  split: "tuning",
  author: "dev-agent",
  added: "2026-10-02",
  checked_by: null,
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

  it("requires every field and refuses unknown ones, forms, intents, splits and languages", () => {
    for (const key of Object.keys(base)) {
      const rest: Record<string, unknown> = { ...base };
      delete rest[key];
      expect(TestQuestionSchema.safeParse(rest).success, `without ${key}`).toBe(false);
    }
    expect(TestQuestionSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, kind: "native" }).success).toBe(false); // split into form and intent
    expect(TestQuestionSchema.safeParse({ ...base, form: "emergency" }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, intent: "native" }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, split: "test" }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, lang: "de" }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, added: "2 Oct 2026" }).success).toBe(false);
  });

  it("takes any form with any intent", () => {
    for (const form of ["native", "romanized", "mixed"]) {
      for (const intent of ["normal", "emergency"]) {
        expect(TestQuestionSchema.safeParse({ ...base, form, intent }).success, `${form} ${intent}`).toBe(true);
      }
      expect(TestQuestionSchema.safeParse({ ...base, form, intent: "no_match", expected: [] }).success, `${form} no_match`).toBe(true);
    }
  });

  it("needs expected empty for no_match and at least one provider id for every other intent", () => {
    expect(TestQuestionSchema.safeParse({ ...base, intent: "no_match", expected: [] }).success).toBe(true);
    expect(TestQuestionSchema.safeParse({ ...base, intent: "no_match", expected: ["M008"] }).success).toBe(false);
    for (const intent of ["normal", "emergency"]) {
      expect(TestQuestionSchema.safeParse({ ...base, intent, expected: [] }).success, intent).toBe(false);
      expect(TestQuestionSchema.safeParse({ ...base, intent, expected: ["M008", "M071"] }).success, intent).toBe(true);
    }
    expect(TestQuestionSchema.safeParse({ ...base, expected: ["M008", "M008"] }).success).toBe(false);
  });

  it("has an optional page_lang that must be a language code", () => {
    expect(TestQuestionSchema.safeParse({ ...base, lang: "ur", form: "romanized", page_lang: "en" }).success).toBe(true);
    expect(TestQuestionSchema.safeParse({ ...base, page_lang: "de" }).success).toBe(false);
  });

  it("takes initials or a handle for the author and checker, never a name or contact details", () => {
    for (const handle of ["dev-agent", "lt", "ab_12", "Q7"]) {
      expect(TestQuestionSchema.safeParse({ ...base, author: handle }).success, handle).toBe(true);
    }
    for (const bad of ["Jane Doe", "jane@example.org", "416-555-0100", "x4165550100", "x", "", "dev agent", "a.b"]) {
      expect(TestQuestionSchema.safeParse({ ...base, author: bad }).success, `author ${bad}`).toBe(false);
      expect(TestQuestionSchema.safeParse({ ...base, checked_by: bad, checked_on: "2026-10-03" }).success, `checked_by ${bad}`).toBe(false);
    }
  });

  it("records the second check as a handle and a date together", () => {
    expect(TestQuestionSchema.safeParse({ ...base, checked_by: "second-reader", checked_on: "2026-10-03" }).success).toBe(true);
    expect(TestQuestionSchema.safeParse({ ...base, checked_by: "second-reader" }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, checked_on: "2026-10-03" }).success).toBe(false);
  });

  it("needs the checker to be someone other than the author, and a check on or after the day the question was added", () => {
    expect(TestQuestionSchema.safeParse({ ...base, checked_by: base.author, checked_on: "2026-10-03" }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, checked_by: "second-reader", checked_on: "2026-10-01" }).success).toBe(false);
    expect(TestQuestionSchema.safeParse({ ...base, checked_by: "second-reader", checked_on: "2026-10-02" }).success).toBe(true);
  });
});

describe("validating a questions file", () => {
  it("reports each problem with its line number", () => {
    const text = [
      line({ id: "en-01" }),
      "",
      "{not json",
      line({ id: "en-02", q: "a".repeat(201) }),
      line({ id: "en-03", intent: "no_match" }),
      line({ id: "en-04", expected: ["M008", "M9999"] }),
      line({ id: "en-01" }),
      line({ id: "en-05", checked_by: "dev-agent", checked_on: "2026-10-03" }),
    ].join("\n");

    expect(errorsOf(text)).toEqual([
      expect.stringMatching(/^f\.jsonl:3: not valid JSON/),
      "f.jsonl:4: q: must be at most 200 characters",
      "f.jsonl:5: expected: must be empty for a no_match question",
      "f.jsonl:6: expected: provider id M9999 is not in data/catalogue/providers.json",
      "f.jsonl:7: id: en-01 is already used on line 1",
      "f.jsonl:8: checked_by: must be someone other than the author",
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
  const expectedOf = (id: string) => questions.find((x) => x.id === id)!.expected;

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
    expect(questions.filter((q) => q.lang === "ur" && q.form === "romanized").length).toBeGreaterThanOrEqual(2);
    expect(questions.filter((q) => q.lang === "hi" && q.form === "mixed").length).toBeGreaterThanOrEqual(1);
    expect(questions.filter((q) => q.intent === "emergency").length).toBeGreaterThanOrEqual(2);
    expect(questions.filter((q) => q.intent === "no_match").length).toBeGreaterThanOrEqual(2);
  });

  it("puts questions of both intents that matter in both subsets", () => {
    for (const split of ["tuning", "evaluation"]) {
      expect(questions.some((q) => q.split === split && q.intent === "emergency"), split).toBe(true);
      expect(questions.some((q) => q.split === split && q.intent === "no_match"), split).toBe(true);
    }
  });

  it("has unique question texts", () => {
    expect(new Set(questions.map((q) => q.q)).size).toBe(questions.length);
  });

  it("is written by dev-agent and honestly unchecked: nobody has done the second check yet", () => {
    expect(questions.every((q) => q.author === "dev-agent" && q.checked_by === null && q.checked_on === null)).toBe(true);
  });

  it("lists every provider whose text answers the question (checked against data/catalogue/providers.json)", () => {
    expect(expectedOf("fr-01")).toContain("M007"); // TNO food collaborative text also covers settlement support
    for (const id of ["pa-02", "zh-02"]) expect(expectedOf(id), id).toEqual(expect.arrayContaining(["M049", "M007"])); // TNO employment services
    expect(expectedOf("prs-01")).toContain("M045"); // Flemingdon Health Centre: free primary care, no OHIP card
    for (const id of ["ur-01", "sk-01"]) expect(expectedOf(id), id).toEqual(expect.arrayContaining(["M052", "M053"])); // community centres with a library branch
  });

  it("does not list providers that do not answer the question", () => {
    expect(expectedOf("sk-02")).not.toContain("M093"); // a tenants association contact list, no help with landlord problems
    expect(expectedOf("el-02")).not.toContain("M019"); // the Archdiocese's administrative office, not a church
    expect(expectedOf("hi-01")).not.toContain("M024"); // an early learning academy, not a primary school
  });
});

// --- the runner, with a fake engine ---------------------------------------------------------------

const q = (
  id: string,
  lang: TestQuestion["lang"],
  form: TestQuestion["form"],
  intent: TestQuestion["intent"],
  expected: string[],
  split: TestQuestion["split"] = "tuning",
): TestQuestion => ({ ...base, id, lang, q: `question ${id}`, form, intent, expected, split });

const QUESTIONS: TestQuestion[] = [
  q("en-1", "en", "native", "normal", ["M008"]), // answered at rank 1
  q("en-2", "en", "native", "normal", ["M008"]), // answered at rank 4: top 5 only
  q("en-3", "en", "native", "emergency", ["M002"]), // 911 first, answered
  q("ur-1", "ur", "romanized", "normal", ["M008"]), // missed
  q("ur-2", "ur", "native", "no_match", []), // wrongly answered
  q("fr-1", "fr", "native", "no_match", []), // correct no match
  q("fr-2", "fr", "native", "normal", ["M022"], "evaluation"), // answered at rank 2
];

/** A SearchV1 body whose scores fall from 0.9 by 0.1 a result. */
function body(ids: string[], changes: Record<string, unknown> = {}) {
  return {
    v: 1,
    release_v: 7,
    query_lang: "en",
    status: ids.length === 0 ? "no_clear_match" : "ok",
    emergency_first: false,
    results: ids.map((provider_id, i) => ({ provider_id, score: Math.round((0.9 - i * 0.1) * 100) / 100 })),
    ...changes,
  };
}

const ANSWERS: Record<string, { ids: string[]; emergency?: boolean }> = {
  "question en-1": { ids: ["M008", "M071"] },
  "question en-2": { ids: ["M001", "M002", "M003", "M008"] },
  "question en-3": { ids: ["M002"], emergency: true },
  "question ur-1": { ids: ["M060", "M061", "M062"] },
  "question ur-2": { ids: ["M060"] },
  "question fr-1": { ids: [] },
  "question fr-2": { ids: ["M001", "M022"] },
};

const fake = async ({ q: text }: EngineInput) => {
  const answer = ANSWERS[text]!;
  return body(answer.ids, { emergency_first: answer.emergency ?? false });
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

const SHA = "a".repeat(64);
const INFO = { date: "2026-10-02", release: "7", model: "embed-v4.0", threshold: 0.35, translatedLeg: true, questionsSha256: SHA };
const BOTH = ["tuning", "evaluation"] as const;

describe("what the engine must answer", () => {
  it("mirrors SearchV1: provider_id and score per result, status with unavailable, release_v, query_lang, emergency_first", () => {
    expect(SearchV1Schema.safeParse(body(["M008"])).success).toBe(true);
    expect(SearchV1Schema.safeParse(body(["M008"], { status: "unavailable" })).success).toBe(true);
    expect(SearchV1Schema.safeParse(body(["M008"], { status: "error" })).success).toBe(false);
    expect(SearchV1Schema.safeParse({ ...body(["M008"]), results: [{ id: "M008" }] }).success).toBe(false);
    for (const key of ["v", "release_v", "query_lang", "status", "emergency_first", "results"]) {
      const rest: Record<string, unknown> = { ...body(["M008"]) };
      delete rest[key];
      expect(SearchV1Schema.safeParse(rest).success, `without ${key}`).toBe(false);
    }
  });

  it("fails the run, naming the question, when an answer is not a SearchV1 body (a real engine must not score 0% silently)", async () => {
    const oldShape: SearchEngine = async () => ({ status: "ok", emergency_first: false, results: [{ id: "M008" }] });
    await expect(runQuestions(QUESTIONS, oldShape)).rejects.toThrow(/question en-1: the engine's answer is not a SearchV1 body \(.*release_v/);
    await expect(runQuestions(QUESTIONS, async () => "nonsense")).rejects.toThrow(/not a SearchV1 body/);
  });
});

describe("running and measuring", () => {
  it("asks each question once, in order, and times it", async () => {
    const asked: string[] = [];
    const results = await runQuestions(
      QUESTIONS,
      async (input) => {
        asked.push(`${input.lang}:${input.q}`);
        return fake(input);
      },
      { now: fakeClock([10, 20, 30, 40, 50, 60, 70]) },
    );
    expect(asked).toHaveLength(7);
    expect(asked[0]).toBe("en:question en-1");
    expect(results.map((r) => r.ms)).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it("sends the page language when the question has one, and the release it is testing", async () => {
    const sent: unknown[] = [];
    const withPage = [{ ...q("ur-9", "ur", "romanized", "normal", ["M008"]), page_lang: "en" as const }, q("fr-9", "fr", "native", "normal", ["M022"])];
    await runQuestions(withPage, async (input) => (sent.push(input), body(["M008"])), { release: 7 });
    expect(sent).toEqual([
      { q: "question ur-9", lang: "en", v: 7 },
      { q: "question fr-9", lang: "fr", v: 7 },
    ]);
  });

  it("reports the subsets separately, per language, per language and form, and overall", async () => {
    const results = await runQuestions(QUESTIONS, fake, { now: fakeClock([10, 20, 30, 40, 50, 60, 70]) });
    const report = buildReport(results, INFO, BOTH);

    expect(TestSetReportSchema.safeParse(report).success).toBe(true);
    expect(report).toMatchObject({ v: 2, date: "2026-10-02", release: "7", model: "embed-v4.0", threshold: 0.35, translated_leg: true, question_count: 7, questions_sha256: SHA });

    const tuning = report.subsets.tuning!;
    // top 3 over the questions that are not no_match: en-1 hit, en-2 miss (rank 4), en-3 hit, ur-1 miss
    expect(tuning.overall.top3).toEqual({ hits: 2, of: 4, rate: 0.5 });
    expect(tuning.overall.top5).toEqual({ hits: 3, of: 4, rate: 0.75 });
    expect(tuning.overall.no_match).toEqual({ hits: 1, of: 2, rate: 0.5 });
    expect(tuning.overall.emergency).toEqual({ hits: 1, of: 1, rate: 1 });
    expect(tuning.overall.false_emergency_rate).toEqual({ hits: 0, of: 5, rate: 0 });
    expect(tuning.overall.error_count).toBe(0);
    expect(tuning.overall.questions).toBe(6);
    expect(tuning.overall.results_returned).toEqual({ total: 11, mean: 1.83 });
    expect(tuning.overall.time_ms).toEqual({ p50: 30, p95: 60 });
    expect(Object.keys(tuning.by_language)).toEqual(["en", "fr", "ur"]);
    expect(tuning.by_language.en!.top3).toEqual({ hits: 2, of: 3, rate: 0.6667 });
    expect(tuning.by_language.ur!.top3).toEqual({ hits: 0, of: 1, rate: 0 });
    expect(tuning.by_language.ur!.no_match).toEqual({ hits: 0, of: 1, rate: 0 });
    expect(tuning.by_language.fr!.top3).toEqual({ hits: 0, of: 0, rate: null });
    expect(tuning.by_language.fr!.no_match).toEqual({ hits: 1, of: 1, rate: 1 });

    expect(Object.keys(tuning.by_language_kind)).toEqual(["en/native", "fr/native", "ur/native", "ur/romanized"]);
    expect(tuning.by_language_kind["ur/romanized"]!.top3).toEqual({ hits: 0, of: 1, rate: 0 });
    expect(tuning.by_language_kind["ur/native"]!.top3).toEqual({ hits: 0, of: 0, rate: null });
    expect(tuning.by_language_kind["ur/native"]!.no_match).toEqual({ hits: 0, of: 1, rate: 0 });

    const evaluation = report.subsets.evaluation!;
    expect(evaluation.overall.questions).toBe(1);
    expect(evaluation.overall.top3).toEqual({ hits: 1, of: 1, rate: 1 });
    expect(Object.keys(evaluation.by_language)).toEqual(["fr"]);
    expect(Object.keys(evaluation.by_language_kind)).toEqual(["fr/native"]);
  });

  it("keeps a row per question: status, ranks of the expected providers, top score, time, emergency_first and query_lang", async () => {
    const results = await runQuestions(QUESTIONS, async (input) => {
      const answer = await fake(input);
      return { ...(answer as object), query_lang: input.q.includes("ur-") ? "ur" : "en" };
    }, { now: fakeClock([10, 20, 30, 40, 50, 60, 70]) });
    const rows = buildReport(results, INFO, BOTH).subsets.tuning!.rows;

    expect(rows.map((r) => r.id)).toEqual(["en-1", "en-2", "en-3", "ur-1", "ur-2", "fr-1"]);
    expect(rows[0]).toEqual({
      id: "en-1", lang: "en", form: "native", intent: "normal", query_lang: "en", status: "ok",
      ranks: { M008: 1 }, top_score: 0.9, ms: 10, emergency_first: false, expected_missing: [],
    });
    expect(rows[1]!.ranks).toEqual({ M008: 4 });
    expect(rows[2]).toMatchObject({ status: "ok", emergency_first: true, ranks: { M002: 1 } });
    expect(rows[3]).toMatchObject({ lang: "ur", form: "romanized", query_lang: "ur", ranks: { M008: null }, top_score: 0.9 });
    expect(rows[5]).toMatchObject({ id: "fr-1", status: "no_clear_match", ranks: {}, top_score: null });
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

  it("names the file {date}-{model}-leg-{on|off}-{split}.json, so runs of one day do not collide", () => {
    expect(reportFileName("2026-10-02", "embed-v4.0", true, "tuning")).toBe("2026-10-02-embed-v4.0-leg-on-tuning.json");
    expect(reportFileName("2026-10-02", "embed-v4.0", false, "evaluation")).toBe("2026-10-02-embed-v4.0-leg-off-evaluation.json");
    expect(reportFileName("2026-10-02", "a/b c", false, "all")).toBe("2026-10-02-a-b-c-leg-off-all.json");
    const names = new Set([true, false].flatMap((leg) => (["tuning", "evaluation", "all"] as const).map((split) => reportFileName("2026-10-02", "m", leg, split))));
    expect(names.size).toBe(6);
  });

  it("takes the default report date in Toronto, not UTC", () => {
    expect(torontoDate(new Date("2026-10-03T02:00:00Z"))).toBe("2026-10-02"); // 22:00 on the 2nd in Toronto (EDT)
    expect(torontoDate(new Date("2026-12-01T04:30:00Z"))).toBe("2026-11-30"); // 23:30 on the 30th (EST)
    expect(torontoDate(new Date("2026-07-01T05:00:00Z"))).toBe("2026-07-01");
  });
});

describe("when the engine fails or is unavailable", () => {
  it("records error:<code>, counts a miss, goes on with the other questions and reports error_count", async () => {
    const flaky: SearchEngine = async (input) => {
      if (input.q === "question en-1") throw Object.assign(new Error("slow down"), { code: "RATE_LIMITED" });
      if (input.q === "question en-2") throw new TypeError("boom");
      return fake(input);
    };
    const results = await runQuestions(QUESTIONS, flaky);
    expect(results).toHaveLength(7);
    const report = buildReport(results, INFO, BOTH);
    const tuning = report.subsets.tuning!;
    expect(tuning.rows.slice(0, 3).map((r) => r.status)).toEqual(["error:RATE_LIMITED", "error:TypeError", "ok"]);
    expect(tuning.rows[0]).toMatchObject({ ranks: { M008: null }, top_score: null, emergency_first: false, query_lang: null });
    expect(tuning.overall.error_count).toBe(2);
    expect(tuning.by_language.en!.error_count).toBe(2);
    expect(tuning.by_language.ur!.error_count).toBe(0);
    expect(tuning.overall.top3).toEqual({ hits: 1, of: 4, rate: 0.25 }); // only en-3 still hits
    expect(report.subsets.evaluation!.overall.error_count).toBe(0);
  });

  it("counts an error on a no_match or emergency question as a miss", async () => {
    const results = await runQuestions(QUESTIONS, async () => {
      throw new Error("down");
    });
    const tuning = buildReport(results, INFO, BOTH).subsets.tuning!;
    expect(tuning.overall.no_match).toEqual({ hits: 0, of: 2, rate: 0 });
    expect(tuning.overall.emergency).toEqual({ hits: 0, of: 1, rate: 0 });
    expect(tuning.overall.error_count).toBe(6);
  });

  it("counts status unavailable as a miss and reports how many", async () => {
    const results = await runQuestions(QUESTIONS, async () => body([], { status: "unavailable" }));
    const tuning = buildReport(results, INFO, BOTH).subsets.tuning!;
    expect(tuning.overall.unavailable_count).toBe(6);
    expect(tuning.overall.no_match).toEqual({ hits: 0, of: 2, rate: 0 });
    expect(tuning.rows[0]!.status).toBe("unavailable");
  });
});

describe("the release being tested", () => {
  it("fails when the release changes during the run", async () => {
    let calls = 0;
    const moving: SearchEngine = async () => body(["M008"], { release_v: calls++ < 2 ? 7 : 8 });
    await expect(runQuestions(QUESTIONS, moving)).rejects.toThrow(/question en-3: the engine's release changed from 7 \(question en-1\) to 8/);
  });

  it("fails when the engine answers from a release other than --release", async () => {
    await expect(runQuestions(QUESTIONS, fake, { release: 6 })).rejects.toThrow(/question en-1: the engine answered from release 7, but --release is 6/);
    await expect(runQuestions(QUESTIONS, fake, { release: 7 })).resolves.toHaveLength(7);
  });
});

describe("expected ids the release does not hold", () => {
  const has = (id: string) => id !== "M002";

  it("are reported separately, and a question none of whose ids is in the release is not scored", async () => {
    const results = await runQuestions(QUESTIONS, Object.assign(async (input: EngineInput) => fake(input), { has }));
    const tuning = buildReport(results, INFO, BOTH).subsets.tuning!;
    expect(tuning.expected_not_in_release).toEqual({ checked: true, ids: ["M002"], question_ids: ["en-3"] });
    expect(tuning.rows[2]!.expected_missing).toEqual(["M002"]);
    // en-3 (only M002 expected) leaves the top-3 count: en-1 hit, en-2 miss, ur-1 miss
    expect(tuning.overall.top3).toEqual({ hits: 1, of: 3, rate: 0.3333 });
    expect(tuning.overall.questions).toBe(6);
  });

  it("scores a question that still has an expected id in the release", async () => {
    const some = [q("en-7", "en", "native", "normal", ["M002", "M008"])];
    const results = await runQuestions(some, { search: async () => body(["M008"]), has });
    const subset = buildReport(results, INFO, ["tuning"]).subsets.tuning!;
    expect(subset.overall.top3).toEqual({ hits: 1, of: 1, rate: 1 });
    expect(subset.expected_not_in_release.ids).toEqual(["M002"]);
  });

  it("are marked as not checked when the engine has no has(id)", async () => {
    const results = await runQuestions(QUESTIONS, fake);
    const tuning = buildReport(results, INFO, BOTH).subsets.tuning!;
    expect(tuning.expected_not_in_release).toEqual({ checked: false, ids: [], question_ids: [] });
  });
});

describe("the second-member check", () => {
  it("counts the questions of the run that nobody has checked", async () => {
    const checked = { ...QUESTIONS[0]!, checked_by: "second-reader", checked_on: "2026-10-03" };
    const results = await runQuestions([checked, ...QUESTIONS.slice(1)], fake);
    expect(buildReport(results, INFO, BOTH).unchecked_count).toBe(6);
    expect(buildReport(await runQuestions([checked], fake), INFO, BOTH).unchecked_count).toBe(0);
  });
});

describe("false 911 blocks", () => {
  it("counts emergency_first on questions that are not emergencies", async () => {
    const always = await runQuestions(QUESTIONS, async (input) => body(ANSWERS[input.q]!.ids, { emergency_first: true }));
    const tuning = buildReport(always, INFO, BOTH).subsets.tuning!;
    expect(tuning.overall.false_emergency_rate).toEqual({ hits: 5, of: 5, rate: 1 });
    expect(tuning.overall.emergency).toEqual({ hits: 1, of: 1, rate: 1 });
    expect(tuning.by_language.en!.false_emergency_rate).toEqual({ hits: 2, of: 2, rate: 1 });
    expect(tuning.by_language_kind["ur/romanized"]!.false_emergency_rate).toEqual({ hits: 1, of: 1, rate: 1 });
    const none = await runQuestions(QUESTIONS, fake);
    expect(buildReport(none, INFO, BOTH).subsets.tuning!.overall.false_emergency_rate.rate).toBe(0);
  });
});

describe("comparing two reports", () => {
  const run = async (answers: Record<string, string[]>, questions = QUESTIONS, info = INFO, subsets: readonly ("tuning" | "evaluation")[] = BOTH) =>
    buildReport(await runQuestions(questions, async ({ q: text }) => body(answers[text] ?? [], { status: "ok", emergency_first: true })), info, subsets);
  const A = { "question en-1": ["M008"], "question ur-1": ["M001"], "question fr-2": ["M022"] };
  const B = { "question en-1": ["M008"], "question ur-1": ["M008"], "question fr-2": ["M001"] };

  it("shows per-language differences and lists every language that got worse", async () => {
    const { lines, worse } = compareReports(await run(A), await run(B));

    expect(worse).toEqual([
      "evaluation fr top 3: 100.0% -> 0.0%",
      "evaluation fr top 5: 100.0% -> 0.0%",
      "evaluation fr/native top 3: 100.0% -> 0.0%",
      "evaluation fr/native top 5: 100.0% -> 0.0%",
      "evaluation overall top 3: 100.0% -> 0.0%",
      "evaluation overall top 5: 100.0% -> 0.0%",
    ]);
    const text = lines.join("\n");
    expect(text).toMatch(/ur\s+0->100 \(\+100\)/);
    expect(text).toMatch(/ur\/romanized\s+0->100 \(\+100\)/);
    expect(text).toMatch(/fr\s+100->0 \(-100\) WORSE/);
    expect(text).toContain("Worse (6):");
  });

  it("says so when nothing got worse", async () => {
    const report = buildReport(await runQuestions(QUESTIONS, fake), INFO, BOTH);
    const { lines, worse, warnings } = compareReports(report, report);
    expect(worse).toEqual([]);
    expect(warnings).toEqual([]);
    expect(lines.at(-1)).toBe("No language got worse.");
  });

  it("counts a language that B does not have as worse", async () => {
    const withoutUrdu = QUESTIONS.filter((x) => x.lang !== "ur");
    const { worse, lines } = compareReports(await run(A), await run(A, withoutUrdu));
    expect(worse).toEqual(expect.arrayContaining(["tuning ur: missing from report B", "tuning ur/romanized: missing from report B", "tuning ur/native: missing from report B"]));
    expect(lines.join("\n")).toMatch(/ur\s+only in report A WORSE/);
    // the other way round is not a loss
    expect(compareReports(await run(A, withoutUrdu), await run(A)).worse.filter((w) => w.includes("missing"))).toEqual([]);
  });

  it("counts a language/form that B does not have as worse even when the language is there", async () => {
    const noRomanized = QUESTIONS.filter((x) => x.form !== "romanized");
    const { worse } = compareReports(await run(A), await run(A, noRomanized));
    expect(worse).toContain("tuning ur/romanized: missing from report B");
    expect(worse).not.toContain("tuning ur: missing from report B");
  });

  it("counts a subset that B did not run as worse", async () => {
    const { worse, lines } = compareReports(await run(A), await run(A, QUESTIONS, INFO, ["tuning"]));
    expect(worse).toEqual(["evaluation subset: missing from report B"]);
    expect(lines.join("\n")).toContain("evaluation subset missing from report B WORSE");
  });

  it("counts more false 911 blocks as worse", async () => {
    const quiet = buildReport(await runQuestions(QUESTIONS, fake), INFO, BOTH);
    const loud = await run(A);
    expect(compareReports(quiet, loud).worse).toContain("tuning overall false 911: 0.0% -> 100.0%");
    expect(compareReports(loud, quiet).worse.filter((w) => w.includes("false 911"))).toEqual([]);
  });

  it("warns when A and B ran different questions", async () => {
    const same = compareReports(await run(A), await run(A));
    expect(same.warnings).toEqual([]);
    const otherFile = compareReports(await run(A), await run(A, QUESTIONS, { ...INFO, questionsSha256: "b".repeat(64) }));
    expect(otherFile.warnings).toEqual([expect.stringContaining("questions_sha256 differs")]);
    expect(otherFile.lines.join("\n")).toContain("WARNING: A and B ran different question files");
    const fewer = compareReports(await run(A), await run(A, QUESTIONS.slice(0, 5)));
    expect(fewer.warnings).toEqual(["A ran 7 questions and B ran 5."]);
  });
});

// --- the command line ----------------------------------------------------------------------------

function cli(args: string[]) {
  const result = spawnSync("node", [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const GOOD_ENGINE = `export default async ({ q }) => ({ v: 1, release_v: 3, query_lang: "en", status: "ok", emergency_first: q.includes("fire"), results: [{ provider_id: "M008", score: 0.9 }, { provider_id: "M071", score: 0.8 }] });\n`;

function engineFile(dir: string, source: string, name = "engine.mjs") {
  const file = path.join(dir, name);
  writeFileSync(file, source);
  return file;
}

const REAL_QUESTIONS = parseQuestions(REAL, IDS).questions;

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

  it("run defaults to the tuning subset, names the file by leg and split, and warns about unchecked questions", () => {
    const dir = tempDir();
    const engine = engineFile(dir, GOOD_ENGINE);
    const common = ["--engine", engine, "--release", "3", "--threshold", "0.4", "--out-dir", dir, "--date", "2026-10-02"];

    const first = cli(["run", ...common, "--model", "model-a", "--translated-leg", "off"]);
    expect(first.code, first.err).toBe(0);
    expect(first.out).toContain("tuning subset");
    expect(first.out).toContain("evaluation subset: not run");
    const tuningCount = REAL_QUESTIONS.filter((x) => x.split === "tuning").length;
    expect(first.err).toContain(`WARNING: ${tuningCount} question(s) not yet checked by a second team member`);
    expect(readdirSync(dir)).toContain("2026-10-02-model-a-leg-off-tuning.json");
    const report = TestSetReportSchema.parse(JSON.parse(readFileSync(path.join(dir, "2026-10-02-model-a-leg-off-tuning.json"), "utf8")));
    expect(report).toMatchObject({ v: 2, release: "3", model: "model-a", threshold: 0.4, translated_leg: false, question_count: tuningCount, unchecked_count: tuningCount });
    expect(report.subsets.evaluation).toBeNull();
    expect(report.questions_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.subsets.tuning!.rows).toHaveLength(tuningCount);

    expect(cli(["run", ...common, "--model", "model-a", "--translated-leg", "off"]).code).toBe(1); // will not overwrite
    const legOn = cli(["run", ...common, "--model", "model-a", "--translated-leg", "on"]);
    expect(legOn.code, legOn.err).toBe(0); // the same day, the same model, the other leg: no collision
    expect(readdirSync(dir).sort()).toEqual(["2026-10-02-model-a-leg-off-tuning.json", "2026-10-02-model-a-leg-on-tuning.json", "engine.mjs"]);
  });

  it("run needs --final for the evaluation subset (evaluation, or all)", () => {
    const dir = tempDir();
    const engine = engineFile(dir, GOOD_ENGINE);
    const common = ["run", "--engine", engine, "--release", "3", "--threshold", "0.4", "--out-dir", dir, "--date", "2026-10-02", "--model", "m", "--translated-leg", "on"];

    for (const split of ["evaluation", "all"]) {
      const refused = cli([...common, "--split", split]);
      expect(refused.code, split).toBe(2);
      expect(refused.err).toContain("--final");
    }
    expect(readdirSync(dir)).toEqual(["engine.mjs"]);

    const evaluation = cli([...common, "--split", "evaluation", "--final"]);
    expect(evaluation.code, evaluation.err).toBe(0);
    expect(evaluation.out).toContain("tuning subset: not run");
    const all = cli([...common, "--split", "all", "--final"]);
    expect(all.code, all.err).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(["2026-10-02-m-leg-on-all.json", "2026-10-02-m-leg-on-evaluation.json", "engine.mjs"]);
    const report = TestSetReportSchema.parse(JSON.parse(readFileSync(path.join(dir, "2026-10-02-m-leg-on-all.json"), "utf8")));
    expect(report.subsets.tuning!.overall.questions + report.subsets.evaluation!.overall.questions).toBe(32);
    expect(report.question_count).toBe(32);
  });

  it("run dates the report in Toronto by default", () => {
    const dir = tempDir();
    const engine = engineFile(dir, GOOD_ENGINE);
    const before = torontoDate();
    const result = cli(["run", "--engine", engine, "--release", "3", "--threshold", "0.4", "--out-dir", dir, "--model", "m", "--translated-leg", "on"]);
    expect(result.code, result.err).toBe(0);
    const after = torontoDate();
    expect([`${before}-m-leg-on-tuning.json`, `${after}-m-leg-on-tuning.json`]).toContain(readdirSync(dir).find((f) => f !== "engine.mjs"));
  });

  it("run records engine errors as misses and reports error_count", () => {
    const dir = tempDir();
    const engine = engineFile(dir, `export default async () => { throw Object.assign(new Error("slow down"), { code: "RATE_LIMITED" }); };\n`);
    const result = cli(["run", "--engine", engine, "--release", "3", "--threshold", "0.4", "--out-dir", dir, "--date", "2026-10-02", "--model", "m", "--translated-leg", "off"]);
    expect(result.code, result.err).toBe(0);
    const tuningCount = REAL_QUESTIONS.filter((x) => x.split === "tuning").length;
    const report = TestSetReportSchema.parse(JSON.parse(readFileSync(path.join(dir, "2026-10-02-m-leg-off-tuning.json"), "utf8")));
    expect(report.subsets.tuning!.overall.error_count).toBe(tuningCount);
    expect(report.subsets.tuning!.rows.every((r) => r.status === "error:RATE_LIMITED")).toBe(true);
    expect(report.subsets.tuning!.overall.top3.hits).toBe(0);
  });

  it("run fails with a clear message, and writes no report, when the engine's answer is not SearchV1", () => {
    const dir = tempDir();
    const engine = engineFile(dir, `export default async () => ({ status: "ok", emergency_first: false, results: [{ id: "M008" }] });\n`);
    const result = cli(["run", "--engine", engine, "--release", "3", "--threshold", "0.4", "--out-dir", dir, "--date", "2026-10-02", "--model", "m", "--translated-leg", "off"]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/The run failed: question \S+: the engine's answer is not a SearchV1 body/);
    expect(readdirSync(dir)).toEqual(["engine.mjs"]);
  });

  it("run fails when the engine's release is not --release", () => {
    const dir = tempDir();
    const engine = engineFile(dir, GOOD_ENGINE.replace("release_v: 3", "release_v: 4"));
    const result = cli(["run", "--engine", engine, "--release", "3", "--threshold", "0.4", "--out-dir", dir, "--date", "2026-10-02", "--model", "m", "--translated-leg", "off"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("answered from release 4, but --release is 3");
  });

  it("run takes an engine that is an object with search() and has(id)", () => {
    const dir = tempDir();
    const engine = engineFile(dir, `export default { search: async () => ({ v: 1, release_v: 3, query_lang: "en", status: "ok", emergency_first: false, results: [] }), has: (id) => id !== "M008" };\n`);
    const result = cli(["run", "--engine", engine, "--release", "3", "--threshold", "0.4", "--out-dir", dir, "--date", "2026-10-02", "--model", "m", "--translated-leg", "off"]);
    expect(result.code, result.err).toBe(0);
    const report = TestSetReportSchema.parse(JSON.parse(readFileSync(path.join(dir, "2026-10-02-m-leg-off-tuning.json"), "utf8")));
    expect(report.subsets.tuning!.expected_not_in_release).toMatchObject({ checked: true, ids: ["M008"] });
  });

  it("compare reads reports back, and warns when they ran different questions", () => {
    const dir = tempDir();
    const engine = engineFile(dir, GOOD_ENGINE);
    const common = ["--engine", engine, "--release", "3", "--threshold", "0.4", "--out-dir", dir, "--date", "2026-10-02", "--model", "m", "--translated-leg", "off"];
    expect(cli(["run", ...common]).code).toBe(0);
    expect(cli(["run", ...common, "--split", "all", "--final"]).code).toBe(0);
    const tuning = path.join(dir, "2026-10-02-m-leg-off-tuning.json");
    const all = path.join(dir, "2026-10-02-m-leg-off-all.json");

    const same = cli(["--compare", tuning, tuning]);
    expect(same.code).toBe(0);
    expect(same.out).toContain("No language got worse.");
    expect(same.out).not.toContain("WARNING");

    const different = cli(["--compare", all, tuning, "--fail-on-worse"]);
    expect(different.code).toBe(1); // the evaluation subset is missing from B
    expect(different.out).toContain("evaluation subset: missing from report B");
    expect(different.out).toContain("WARNING: A ran 32 questions");
  });

  it("run needs its options, and compare needs two readable reports", () => {
    expect(cli(["run"]).code).toBe(2);
    expect(cli(["--compare", "only-one"]).code).toBe(2);
    expect(cli(["--compare", "missing-a.json", "missing-b.json"]).code).toBe(1);
    expect(cli([]).code).toBe(2);
  });
});
