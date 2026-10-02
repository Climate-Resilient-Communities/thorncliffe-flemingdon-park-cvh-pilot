// The search test set (FR-D2-Q, AR-24): the format of one question, and of the report a run writes.
// Questions live one per line in data/search-test-set/questions.jsonl; scripts/search-test-set reads
// them and fails with the line number when one does not fit. Only zod is imported, so this is safe
// to use anywhere.
import { z } from "zod";
import { LangCodeSchema } from "./lang";
import { STAFF_ROLES } from "./staffRoles";

export const QUESTION_KINDS = ["native", "romanized", "mixed", "emergency", "no_match"] as const;
export const QUESTION_SPLITS = ["tuning", "evaluation"] as const;
/** Who wrote (or checked) a question: a staff role, or a developer of the team. */
export const AUTHOR_ROLES = [...STAFF_ROLES, "developer"] as const;
export const MAX_QUESTION_LENGTH = 200;

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date as YYYY-MM-DD");
const RoleSchema = z.enum(AUTHOR_ROLES);

export const TestQuestionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase letters, digits and hyphens"),
    lang: LangCodeSchema,
    q: z
      .string()
      .min(1)
      .refine((value) => value.trim() === value, "must have no leading or trailing space")
      .refine((value) => [...value].length <= MAX_QUESTION_LENGTH, `must be at most ${MAX_QUESTION_LENGTH} characters`),
    kind: z.enum(QUESTION_KINDS),
    /** Provider ids that answer the question: empty for no_match, one or more for every other kind. */
    expected: z.array(z.string().min(1)).refine((ids) => new Set(ids).size === ids.length, "must not repeat a provider id"),
    split: z.enum(QUESTION_SPLITS),
    author_role: RoleSchema,
    added: DateSchema,
    /** The second team member who checked the question and the expected providers; null until someone has. */
    checked_by_role: RoleSchema.nullable(),
    checked_on: DateSchema.nullable(),
  })
  .strict()
  .superRefine((question, ctx) => {
    if (question.kind === "no_match" && question.expected.length > 0) {
      ctx.addIssue({ code: "custom", path: ["expected"], message: "must be empty for a no_match question" });
    }
    if (question.kind !== "no_match" && question.expected.length === 0) {
      ctx.addIssue({ code: "custom", path: ["expected"], message: `must hold at least one provider id for a ${question.kind} question` });
    }
    if ((question.checked_by_role === null) !== (question.checked_on === null)) {
      ctx.addIssue({ code: "custom", path: ["checked_by_role"], message: "checked_by_role and checked_on are both set or both null" });
    }
  });

export type TestQuestion = z.infer<typeof TestQuestionSchema>;

// --- the report ---------------------------------------------------------------------------------

const RateSchema = z.object({ hits: z.number().int().min(0), of: z.number().int().min(0), rate: z.number().min(0).max(1).nullable() }).strict();

export const MetricsSchema = z
  .object({
    questions: z.number().int().min(0),
    /** Hit rate with the expected provider in the first 3 results, over the questions that are not no_match. */
    top3: RateSchema,
    top5: RateSchema,
    /** no_match questions answered with "no clear match". */
    no_match: RateSchema,
    /** emergency questions answered with the 911 block first. */
    emergency: RateSchema,
    results_returned: z.object({ total: z.number().int().min(0), mean: z.number().min(0).nullable() }).strict(),
    time_ms: z.object({ p50: z.number().min(0).nullable(), p95: z.number().min(0).nullable() }).strict(),
  })
  .strict();

export type Metrics = z.infer<typeof MetricsSchema>;

export const SubsetReportSchema = z.object({ overall: MetricsSchema, by_language: z.record(z.string(), MetricsSchema) }).strict();

export type SubsetReport = z.infer<typeof SubsetReportSchema>;

export const TestSetReportSchema = z
  .object({
    v: z.literal(1),
    date: DateSchema,
    release: z.string().min(1),
    model: z.string().min(1),
    threshold: z.number(),
    translated_leg: z.boolean(),
    question_count: z.number().int().min(0),
    /** A subset that was not run is null (the evaluation subset stays unrun until S03.08). */
    subsets: z.object({ tuning: SubsetReportSchema.nullable(), evaluation: SubsetReportSchema.nullable() }).strict(),
  })
  .strict();

export type TestSetReport = z.infer<typeof TestSetReportSchema>;
