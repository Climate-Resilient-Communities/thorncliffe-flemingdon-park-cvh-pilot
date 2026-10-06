// scripts/search-test-set: the launch bar and the evaluation subset, as the guard reads them (S03.09).
//
// S03.08 owns both files; this is a minimal reader of the shape agreed with it, kept here until S03.08's own module lands
// and can replace it (the guard imports only `readBar`, `parseBar`, `evaluationIds` and `checkBar` from this file):
//   data/search-test-set/bar.json      {"version":1,"approvedBy":string|null,"approvedOn":"YYYY-MM-DD"|null,
//                                       "minimums":{"hitRate":{"<lang>":0..1},"noMatchAccuracy":0..1,"emergencyAccuracy":0..1}}
//   data/search-test-set/subsets.json  {"seed":int,"evaluation":[question ids],"tuning":[question ids]}
// A bar that nobody has approved (approvedBy or approvedOn null) or that holds no minimum is "no bar yet": the guard reports
// that and passes, so nothing is measured (and no Cohere call is made) before the Hub has set one.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { SubsetReport } from "@/contracts/searchTestSet";
import type { SEARCH_BAR_MEASURES } from "@/modules/ops";

export const BAR_FILE = "data/search-test-set/bar.json";
export const SUBSETS_FILE = "data/search-test-set/subsets.json";

const share = z.number().min(0).max(1);

const BarFileSchema = z.object({
  version: z.literal(1),
  approvedBy: z.string().trim().min(1).nullable(),
  approvedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  minimums: z
    .object({
      hitRate: z.record(z.string().regex(/^[a-z]{2,3}$/), share).optional(),
      noMatchAccuracy: share.nullable().optional(),
      emergencyAccuracy: share.nullable().optional(),
    })
    .nullable()
    .optional(),
});

/** The Hub-approved minimums: a measure that is absent has no minimum. */
export interface Bar {
  approvedBy: string;
  approvedOn: string;
  hitRate: Record<string, number>;
  noMatchAccuracy: number | null;
  emergencyAccuracy: number | null;
}

export type BarState = { set: true; bar: Bar } | { set: false; reason: string };

/** Reads bar.json's text; throws on a file that is not the agreed shape (a broken bar must not pass as "no bar"). */
export function parseBar(text: string): BarState {
  const parsed = BarFileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`${BAR_FILE} is not a launch bar: ${parsed.error.issues.map((i) => `${i.path.join(".") || "file"} ${i.message}`).join("; ")}`);
  const { approvedBy, approvedOn, minimums } = parsed.data;
  if (approvedBy === null || approvedOn === null) return { set: false, reason: "the launch bar has not been approved yet (approvedBy or approvedOn is null)" };
  const hitRate = minimums?.hitRate ?? {};
  const noMatchAccuracy = minimums?.noMatchAccuracy ?? null;
  const emergencyAccuracy = minimums?.emergencyAccuracy ?? null;
  if (Object.keys(hitRate).length === 0 && noMatchAccuracy === null && emergencyAccuracy === null) return { set: false, reason: "the launch bar holds no minimum yet" };
  return { set: true, bar: { approvedBy, approvedOn, hitRate, noMatchAccuracy, emergencyAccuracy } };
}

/** The bar at `file` (default bar.json under `root`); a missing file is "no bar yet". */
export function readBar(root: string, file?: string): BarState {
  const where = file ? path.resolve(file) : path.join(root, BAR_FILE);
  if (!existsSync(where)) return { set: false, reason: `there is no ${BAR_FILE} yet` };
  return parseBar(readFileSync(where, "utf8"));
}

const SubsetsFileSchema = z.object({
  seed: z.number().int(),
  evaluation: z.array(z.string().min(1)),
  tuning: z.array(z.string().min(1)),
});

/**
 * The ids of the evaluation subset: subsets.json's `evaluation` list when the file exists (S03.08 commits the assignment),
 * otherwise the questions whose `split` is evaluation. An id the questions file does not hold is an error, not a smaller run.
 */
export function evaluationIds(root: string, questions: readonly { id: string; split: string }[]): { ok: true; ids: string[]; source: string } | { ok: false; error: string } {
  const where = path.join(root, SUBSETS_FILE);
  if (!existsSync(where)) return { ok: true, ids: questions.filter((q) => q.split === "evaluation").map((q) => q.id), source: "the questions' split" };
  const parsed = SubsetsFileSchema.safeParse(JSON.parse(readFileSync(where, "utf8")));
  if (!parsed.success) return { ok: false, error: `${SUBSETS_FILE} is not a subset assignment: ${parsed.error.issues.map((i) => i.path.join(".") || "file").join(", ")}` };
  const known = new Set(questions.map((q) => q.id));
  const unknown = parsed.data.evaluation.filter((id) => !known.has(id));
  if (unknown.length > 0) return { ok: false, error: `${SUBSETS_FILE} names evaluation questions that data/search-test-set/questions.jsonl does not hold: ${unknown.join(", ")}` };
  return { ok: true, ids: [...new Set(parsed.data.evaluation)], source: SUBSETS_FILE };
}

/** The measures the bar sets a minimum for: the codes of ops' `search.below_bar` event and of the weekly review. */
export type BarMeasure = (typeof SEARCH_BAR_MEASURES)[number];

/** A measure below its minimum; `observed` is null when the run could not measure it (no question of it was scored). */
export interface Shortfall {
  measure: BarMeasure;
  lang: string | null;
  observed: number | null;
  minimum: number;
}

/** Every minimum of the bar that the evaluation subset's report does not meet, hit rate by language first, in language order. */
export function checkBar(bar: Bar, report: SubsetReport): Shortfall[] {
  const out: Shortfall[] = [];
  for (const lang of Object.keys(bar.hitRate).sort()) {
    const minimum = bar.hitRate[lang]!;
    const observed = report.by_language[lang]?.top3.rate ?? null;
    if (observed === null || observed < minimum) out.push({ measure: "hit_rate", lang, observed, minimum });
  }
  if (bar.noMatchAccuracy !== null) {
    const observed = report.overall.no_match.rate;
    if (observed === null || observed < bar.noMatchAccuracy) out.push({ measure: "no_match_accuracy", lang: null, observed, minimum: bar.noMatchAccuracy });
  }
  if (bar.emergencyAccuracy !== null) {
    const observed = report.overall.emergency.rate;
    if (observed === null || observed < bar.emergencyAccuracy) out.push({ measure: "emergency_accuracy", lang: null, observed, minimum: bar.emergencyAccuracy });
  }
  return out;
}

const MEASURE_NAMES: Record<BarMeasure, string> = { hit_rate: "hit rate", no_match_accuracy: "no-match accuracy", emergency_accuracy: "emergency accuracy" };
const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

/** One line per shortfall, naming the measure and the drop below its minimum. */
export function formatShortfall(s: Shortfall): string {
  const name = s.lang === null ? MEASURE_NAMES[s.measure] : `${MEASURE_NAMES[s.measure]} (${s.lang})`;
  if (s.observed === null) return `${name}: not measured (no question of it was scored), minimum ${percent(s.minimum)}`;
  return `${name}: ${percent(s.observed)}, below the minimum ${percent(s.minimum)} by ${((s.minimum - s.observed) * 100).toFixed(1)} points`;
}

/** Each minimum of the bar, as lines for the plan and the summary. */
export function formatBar(bar: Bar): string[] {
  const langs = Object.keys(bar.hitRate).sort();
  const lines = [`Launch bar approved by ${bar.approvedBy} on ${bar.approvedOn}:`];
  if (langs.length > 0) lines.push(`  hit rate (top 3): ${langs.map((lang) => `${lang} ${percent(bar.hitRate[lang]!)}`).join(", ")}`);
  if (bar.noMatchAccuracy !== null) lines.push(`  no-match accuracy: ${percent(bar.noMatchAccuracy)}`);
  if (bar.emergencyAccuracy !== null) lines.push(`  emergency accuracy: ${percent(bar.emergencyAccuracy)}`);
  return lines;
}
