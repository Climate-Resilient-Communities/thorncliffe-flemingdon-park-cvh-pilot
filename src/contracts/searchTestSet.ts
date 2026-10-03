// The search test set (FR-D2-Q, AR-22, AD-24): the format of one question, what a search engine must
// answer, and the report a run writes. Questions live one per line in
// data/search-test-set/questions.jsonl; scripts/search-test-set reads them and fails with the line
// number when one does not fit. Only zod is imported, so this is safe to use anywhere.
import { z } from "zod";
import { LangCodeSchema } from "./lang";

/** How the question is written: in the language's own script, in Latin letters, or a mix of both. */
export const QUESTION_FORMS = ["native", "romanized", "mixed"] as const;
/** What the resident needs: an ordinary answer, the 911 block first, or nothing the directory has. */
export const QUESTION_INTENTS = ["normal", "emergency", "no_match"] as const;
export const QUESTION_SPLITS = ["tuning", "evaluation"] as const;
export const MAX_QUESTION_LENGTH = 200;

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date as YYYY-MM-DD");
/** Initials or a handle (letters, digits, hyphen, underscore): never a real name or contact details. */
export const HANDLE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,31}$/;
const HandleSchema = z
  .string()
  .regex(HANDLE_PATTERN, "must be initials or a handle: 2 to 32 letters, digits, - or _, starting with a letter (no names, no contact details)")
  .refine((value) => (value.match(/\d/g) ?? []).length <= 4, "must not hold more than 4 digits (no phone numbers)");

export const TestQuestionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase letters, digits and hyphens"),
    /** The language the question is written in. */
    lang: LangCodeSchema,
    /** The language of the page the resident asks from, when it differs from `lang`; sent to the engine as `lang`. */
    page_lang: LangCodeSchema.optional(),
    q: z
      .string()
      .min(1)
      .refine((value) => value.trim() === value, "must have no leading or trailing space")
      .refine((value) => [...value].length <= MAX_QUESTION_LENGTH, `must be at most ${MAX_QUESTION_LENGTH} characters`),
    form: z.enum(QUESTION_FORMS),
    intent: z.enum(QUESTION_INTENTS),
    /** Provider ids that answer the question: empty for no_match, one or more for every other intent. */
    expected: z.array(z.string().min(1)).refine((ids) => new Set(ids).size === ids.length, "must not repeat a provider id"),
    split: z.enum(QUESTION_SPLITS),
    /**
     * Who wrote the question. `dev-agent` wrote the S03.01 starter set. `claude-draft` means machine-written by
     * Claude for search tuning: not checked by a native speaker or ambassador, and never in the evaluation split.
     */
    author: HandleSchema,
    added: DateSchema,
    /** The second team member who checked the question and the expected providers; null until someone has. */
    checked_by: HandleSchema.nullable(),
    checked_on: DateSchema.nullable(),
  })
  .strict()
  .superRefine((question, ctx) => {
    if (question.intent === "no_match" && question.expected.length > 0) {
      ctx.addIssue({ code: "custom", path: ["expected"], message: "must be empty for a no_match question" });
    }
    if (question.intent !== "no_match" && question.expected.length === 0) {
      ctx.addIssue({ code: "custom", path: ["expected"], message: `must hold at least one provider id for a ${question.intent} question` });
    }
    if ((question.checked_by === null) !== (question.checked_on === null)) {
      ctx.addIssue({ code: "custom", path: ["checked_by"], message: "checked_by and checked_on are both set or both null" });
    }
    if (question.checked_by !== null && question.checked_by === question.author) {
      ctx.addIssue({ code: "custom", path: ["checked_by"], message: "must be someone other than the author" });
    }
    if (question.checked_on !== null && question.checked_on < question.added) {
      ctx.addIssue({ code: "custom", path: ["checked_on"], message: "must not be before the date the question was added" });
    }
  });

export type TestQuestion = z.infer<typeof TestQuestionSchema>;
export type QuestionForm = (typeof QUESTION_FORMS)[number];
export type QuestionIntent = (typeof QUESTION_INTENTS)[number];
export type QuestionSplit = (typeof QUESTION_SPLITS)[number];

// --- what a search engine answers (SearchV1, AD-20) ----------------------------------------------

/** The engine's answer: the `SearchV1` body of ARCHITECTURE-SPINE.md (AD-20). `unavailable` is the status when search cannot answer. */
export const SearchV1Schema = z.object({
  v: z.literal(1),
  release_v: z.number().int().min(0),
  query_lang: LangCodeSchema,
  status: z.enum(["ok", "no_clear_match", "unavailable"]),
  emergency_first: z.boolean(),
  results: z.array(z.object({ provider_id: z.string().min(1), score: z.number() })),
});

export type SearchV1 = z.infer<typeof SearchV1Schema>;

// --- the report ---------------------------------------------------------------------------------

const RateSchema = z.object({ hits: z.number().int().min(0), of: z.number().int().min(0), rate: z.number().min(0).max(1).nullable() }).strict();

export const MetricsSchema = z
  .object({
    questions: z.number().int().min(0),
    /** Hit rate with an expected provider in the first 3 results, over the questions that are not no_match (and not unanswerable, see `expected_not_in_release`). */
    top3: RateSchema,
    top5: RateSchema,
    /** no_match questions answered with "no clear match". */
    no_match: RateSchema,
    /** emergency questions answered with the 911 block first. */
    emergency: RateSchema,
    /** Questions that are not emergencies but got the 911 block first. Lower is better. */
    false_emergency_rate: RateSchema,
    /** Questions the engine failed to answer (outcome `error:<code>`); each counts as a miss. */
    error_count: z.number().int().min(0),
    /** Questions the engine answered with status `unavailable`; each counts as a miss. */
    unavailable_count: z.number().int().min(0),
    results_returned: z.object({ total: z.number().int().min(0), mean: z.number().min(0).nullable() }).strict(),
    time_ms: z.object({ p50: z.number().min(0).nullable(), p95: z.number().min(0).nullable() }).strict(),
  })
  .strict();

export type Metrics = z.infer<typeof MetricsSchema>;

/** `ok`, `no_clear_match`, `unavailable`, or `error:<code>` when the engine threw. */
export const OUTCOME_PATTERN = /^(ok|no_clear_match|unavailable|error:.+)$/;

export const RowSchema = z
  .object({
    id: z.string().min(1),
    lang: LangCodeSchema,
    form: z.enum(QUESTION_FORMS),
    intent: z.enum(QUESTION_INTENTS),
    /** The language the engine says it answered in; null when it did not answer. */
    query_lang: LangCodeSchema.nullable(),
    status: z.string().regex(OUTCOME_PATTERN),
    /** For each expected provider, its 1-based rank in the results, or null when it was not returned. */
    ranks: z.record(z.string(), z.number().int().min(1).nullable()),
    top_score: z.number().nullable(),
    ms: z.number().min(0),
    emergency_first: z.boolean(),
    /** Expected provider ids the release does not hold. */
    expected_missing: z.array(z.string()),
  })
  .strict();

export type Row = z.infer<typeof RowSchema>;

export const SubsetReportSchema = z
  .object({
    overall: MetricsSchema,
    by_language: z.record(z.string(), MetricsSchema),
    /** Keyed `{lang}/{form}`, for example `ur/romanized`. */
    by_language_kind: z.record(z.string(), MetricsSchema),
    /** Expected provider ids that the release does not hold; `checked` is false when the engine could not say. */
    expected_not_in_release: z.object({ checked: z.boolean(), ids: z.array(z.string()), question_ids: z.array(z.string()) }).strict(),
    rows: z.array(RowSchema),
  })
  .strict();

export type SubsetReport = z.infer<typeof SubsetReportSchema>;

export const TestSetReportSchema = z
  .object({
    v: z.literal(2),
    date: DateSchema,
    release: z.string().min(1),
    model: z.string().min(1),
    threshold: z.number(),
    translated_leg: z.boolean(),
    /** The number of questions that were run. */
    question_count: z.number().int().min(0),
    /** sha256 (hex) of data/search-test-set/questions.jsonl as it was run. */
    questions_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** Questions of this run that no second team member has checked. */
    unchecked_count: z.number().int().min(0),
    /** A subset that was not run is null (the evaluation subset stays unrun until S03.08). */
    subsets: z.object({ tuning: SubsetReportSchema.nullable(), evaluation: SubsetReportSchema.nullable() }).strict(),
  })
  .strict();

export type TestSetReport = z.infer<typeof TestSetReportSchema>;
