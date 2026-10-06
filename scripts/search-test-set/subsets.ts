// Coverage and the evaluation split of the full test set (S03.08).
//
// Coverage: every launch language has at least 10 questions, and the set at least 5 romanized Urdu (`ur`, form `romanized`),
// 3 Hinglish (`hi`, form `mixed`), 10 emergency and 10 no_match questions. The evaluation subset holds at least 4 questions per
// launch language, 4 emergency and 4 no_match.
//
// The split is data/search-test-set/subsets.json, assigned by `scripts/search-test-set assign` (and by `import`) from the
// committed seed, before any run. The rule:
//
//   1. A question already in subsets.json keeps its subset, whatever is added later: a tuning question has been used for tuning
//      and can never become evidence, and an evaluation question stays evidence. Removing a question removes its id.
//   2. Each new question gets a key: sha256 of "{seed}:{id}". New questions are taken in key order (so the draw is random but the
//      same every time for the same seed and ids).
//   3. In that order, new questions go to evaluation while it holds fewer than 4 emergency questions, then fewer than 4 no_match
//      questions, then, language by language in the order of LANG_CODES, fewer than 4 questions of that language. A question
//      written by `claude-draft` (machine drafts, never checked by a speaker) is never put in evaluation.
//   4. Every other new question goes to tuning.
//
// So the same set, the same seed and the same subsets.json give the same file, and new questions never move existing ones.
// questions.jsonl repeats each question's subset in its `split` field, which must agree with subsets.json.
import { createHash } from "node:crypto";
import type { TestQuestion } from "@/contracts/searchTestSet";
import { COVERAGE_MINIMUMS, EVALUATION_MINIMUMS, LAUNCH_LANGS, type SubsetsFile } from "@/contracts/searchTestSetLaunch";

export const SUBSETS_FILE = "data/search-test-set/subsets.json";
/** The committed seed of the evaluation draw: chosen once (2026-10-06), never changed, so the draw can be repeated. */
export const DEFAULT_SEED = 20261006;
/** The author of machine drafts (S03.01): tuning only. */
export const DRAFT_AUTHOR = "claude-draft";

// --- coverage ------------------------------------------------------------------------------------

export type Gap = { name: string; have: number; need: number };
export type Coverage = { questions: number; drafts: number; gaps: Gap[]; evaluationGaps: Gap[] };

type Minimums = { perLanguage: number; emergency: number; noMatch: number; romanizedUrdu?: number; hinglish?: number };

function counts(questions: readonly Pick<TestQuestion, "lang" | "form" | "intent">[], minimums: Minimums, prefix: string): Gap[] {
  const gaps: Gap[] = [];
  const check = (name: string, have: number, need: number) => {
    if (have < need) gaps.push({ name: `${prefix}${name}`, have, need });
  };
  for (const lang of LAUNCH_LANGS) check(`${lang} questions`, questions.filter((q) => q.lang === lang).length, minimums.perLanguage);
  if (minimums.romanizedUrdu !== undefined) check("romanized Urdu questions (ur, romanized)", questions.filter((q) => q.lang === "ur" && q.form === "romanized").length, minimums.romanizedUrdu);
  if (minimums.hinglish !== undefined) check("Hinglish questions (hi, mixed)", questions.filter((q) => q.lang === "hi" && q.form === "mixed").length, minimums.hinglish);
  check("emergency questions", questions.filter((q) => q.intent === "emergency").length, minimums.emergency);
  check("no-match questions", questions.filter((q) => q.intent === "no_match").length, minimums.noMatch);
  return gaps;
}

/**
 * The set's gaps against the launch coverage, and the evaluation subset's against its minimums; both empty when the set is ready.
 * Machine drafts (`claude-draft`) are tuning aids, not the launch set written with ambassadors, so they are not counted.
 */
export function checkCoverage(all: readonly TestQuestion[]): Coverage {
  const questions = all.filter((q) => q.author !== DRAFT_AUTHOR);
  return {
    questions: questions.length,
    drafts: all.length - questions.length,
    gaps: counts(questions, COVERAGE_MINIMUMS, ""),
    evaluationGaps: counts(
      questions.filter((q) => q.split === "evaluation"),
      EVALUATION_MINIMUMS,
      "evaluation subset: ",
    ),
  };
}

export function formatCoverage(coverage: Coverage): string[] {
  const met = coverage.gaps.length === 0 && coverage.evaluationGaps.length === 0;
  const lines = [
    `Test-set coverage: ${coverage.questions} questions counted (${coverage.drafts} ${DRAFT_AUTHOR} drafts not counted). Launch readiness (coverage): ${met ? "met" : "not met"}`,
  ];
  for (const gap of [...coverage.gaps, ...coverage.evaluationGaps]) lines.push(`  gap: ${gap.name}: ${gap.have} of ${gap.need}`);
  return lines;
}

// --- the evaluation split ------------------------------------------------------------------------

export function drawKey(seed: number, id: string): string {
  return createHash("sha256").update(`${seed}:${id}`).digest("hex");
}

export type Assignment = { file: SubsetsFile; evaluation: string[]; tuning: string[]; removed: string[] };

/**
 * Assigns every question not yet in `previous` to a subset by the rule above. `previous` null means nothing is assigned yet.
 * Ids are written sorted, so the file does not depend on the order of questions.jsonl.
 */
export function assignSubsets(questions: readonly Pick<TestQuestion, "id" | "lang" | "intent" | "author">[], previous: SubsetsFile | null, seed: number = previous?.seed ?? DEFAULT_SEED): Assignment {
  if (previous && previous.seed !== seed) throw new Error(`subsets.json was drawn with seed ${previous.seed}, not ${seed}: the seed is never changed`);
  const ids = new Set(questions.map((q) => q.id));
  const evaluation = new Set((previous?.evaluation ?? []).filter((id) => ids.has(id)));
  const tuning = new Set((previous?.tuning ?? []).filter((id) => ids.has(id)));
  const removed = [...(previous?.evaluation ?? []), ...(previous?.tuning ?? [])].filter((id) => !ids.has(id));

  const fresh = questions.filter((q) => !evaluation.has(q.id) && !tuning.has(q.id));
  const order = [...fresh].sort((a, b) => (drawKey(seed, a.id) < drawKey(seed, b.id) ? -1 : 1));
  const inEvaluation = (test: (q: (typeof questions)[number]) => boolean) => questions.filter((q) => evaluation.has(q.id) && test(q)).length;
  const added: string[] = [];
  const fill = (test: (q: (typeof questions)[number]) => boolean, need: number) => {
    for (const q of order) {
      if (inEvaluation(test) >= need) return;
      if (q.author === DRAFT_AUTHOR || evaluation.has(q.id) || !test(q)) continue;
      evaluation.add(q.id);
      added.push(q.id);
    }
  };
  fill((q) => q.intent === "emergency", EVALUATION_MINIMUMS.emergency);
  fill((q) => q.intent === "no_match", EVALUATION_MINIMUMS.noMatch);
  for (const lang of LAUNCH_LANGS) fill((q) => q.lang === lang, EVALUATION_MINIMUMS.perLanguage);
  const toTuning = fresh.filter((q) => !evaluation.has(q.id)).map((q) => q.id);
  for (const id of toTuning) tuning.add(id);

  const sorted = (set: Set<string>) => [...set].sort();
  return { file: { seed, evaluation: sorted(evaluation), tuning: sorted(tuning) }, evaluation: added.sort(), tuning: toTuning.sort(), removed: removed.sort() };
}

/** Where questions.jsonl and subsets.json disagree, or a draft sits in evaluation; empty when they agree. */
export function checkSubsets(questions: readonly Pick<TestQuestion, "id" | "split" | "author">[], file: SubsetsFile): string[] {
  const problems: string[] = [];
  const evaluation = new Set(file.evaluation);
  const tuning = new Set(file.tuning);
  const ids = new Set(questions.map((q) => q.id));
  for (const q of questions) {
    const listed = evaluation.has(q.id) ? "evaluation" : tuning.has(q.id) ? "tuning" : null;
    if (listed === null) problems.push(`${q.id} is not in ${SUBSETS_FILE}: run \`npm run search-test-set -- assign\``);
    else if (listed !== q.split) problems.push(`${q.id} has split ${q.split} in questions.jsonl but is in ${listed} in ${SUBSETS_FILE}`);
    if (q.author === DRAFT_AUTHOR && evaluation.has(q.id)) problems.push(`${q.id} is a ${DRAFT_AUTHOR} question in the evaluation subset`);
  }
  for (const id of [...evaluation, ...tuning]) if (!ids.has(id)) problems.push(`${id} is in ${SUBSETS_FILE} but not in questions.jsonl`);
  return problems;
}

export function subsetsJson(file: SubsetsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
