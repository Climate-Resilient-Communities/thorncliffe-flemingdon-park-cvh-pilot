// The search test set at launch (S03.08): the coverage the full set must reach, the committed split of questions into the
// tuning and evaluation subsets (data/search-test-set/subsets.json), and the Hub-approved launch bar
// (data/search-test-set/bar.json). Only zod is imported, so this is safe to use anywhere.
import { z } from "zod";
import { LANG_CODES, type LangCode } from "./lang";

/** The 15 launch languages: every language code but zh-Hant, which is a display variant of zh (AD-20). */
export const LAUNCH_LANGS = LANG_CODES.filter((lang): lang is Exclude<LangCode, "zh-Hant"> => lang !== "zh-Hant");

/** What the full test set must hold before launch (S03.08). */
export const COVERAGE_MINIMUMS = {
  /** Questions in each launch language. */
  perLanguage: 10,
  /** `ur` questions written in Latin letters (form `romanized`). */
  romanizedUrdu: 5,
  /** `hi` questions mixing Hindi and English (form `mixed`), as in the S03.01 starter set. */
  hinglish: 3,
  emergency: 10,
  noMatch: 10,
} as const;

/** What the evaluation subset must hold, assigned by the committed seed before any run (S03.08). */
export const EVALUATION_MINIMUMS = { perLanguage: 4, emergency: 4, noMatch: 4 } as const;

const QuestionIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** data/search-test-set/subsets.json: which question is in which subset. Ids are sorted and appear once. */
export const SubsetsFileSchema = z
  .object({
    seed: z.number().int().min(0).max(2 ** 31 - 1),
    evaluation: z.array(QuestionIdSchema),
    tuning: z.array(QuestionIdSchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const name of ["evaluation", "tuning"] as const) {
      for (const id of file[name]) {
        if (seen.has(id)) ctx.addIssue({ code: "custom", path: [name], message: `${id} is listed more than once` });
        seen.add(id);
      }
    }
  });

export type SubsetsFile = z.infer<typeof SubsetsFileSchema>;

const ShareSchema = z.number().min(0).max(1);
const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date as YYYY-MM-DD");

/**
 * data/search-test-set/bar.json: the Hub-approved minimums, all measured on the evaluation subset. `hitRate` is the top-3 hit
 * rate per language (keyed by launch language code), `noMatchAccuracy` and `emergencyAccuracy` the overall shares. Until the
 * Hub approves it, `approvedBy` and `approvedOn` are null and the minimums are a placeholder that sets nothing: an unapproved
 * bar is never met. Launch readiness also needs a minimum for every launch language (checked by meetsBar, not here, so a bar
 * that names fewer still guards the languages it names).
 */
export const BarSchema = z
  .object({
    version: z.literal(1),
    approvedBy: z.string().min(1).nullable(),
    approvedOn: DaySchema.nullable(),
    minimums: z
      .object({
        hitRate: z.record(z.string(), ShareSchema),
        noMatchAccuracy: ShareSchema,
        emergencyAccuracy: ShareSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((bar, ctx) => {
    if ((bar.approvedBy === null) !== (bar.approvedOn === null)) {
      ctx.addIssue({ code: "custom", path: ["approvedBy"], message: "approvedBy and approvedOn are both set or both null" });
    }
    for (const lang of Object.keys(bar.minimums.hitRate)) {
      if (!(LAUNCH_LANGS as readonly string[]).includes(lang)) {
        ctx.addIssue({ code: "custom", path: ["minimums", "hitRate", lang], message: `${lang} is not a launch language` });
      }
    }
  });

export type BarFile = z.infer<typeof BarSchema>;
