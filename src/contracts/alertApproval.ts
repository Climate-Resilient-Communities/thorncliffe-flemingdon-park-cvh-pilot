// What an approver reviews and confirms (S04.07, AD-5, AD-7, AD-20): the number of people an alert's text will reach, per language,
// as it stood when the approval view loaded (the reviewed count) and as the recipient snapshot captured it inside the approval
// transaction. The two are compared before anything commits: if they differ, the approval is refused and the approver reviews the new
// number first. Pure and browser-safe: it imports only zod and the language list.
//
// The count is of people, grouped by the language of the text each one gets (a person whose own language has no frozen text gets the
// English text, so they count under `en`): that is the grouping the cost estimate needs, because a text's segments depend on its
// language (AD-21).
import { z } from "zod";
import { LangCodeSchema, type LangCode } from "./lang";

/** At most 500 characters in the note an approver writes when they send an entry back to its author. */
export const RETURN_NOTE_MAX = 500;

/** The most people one alert's count may hold (a sanity bound: the pilot has a few thousand subscribers). */
const COUNT_MAX = 1_000_000;

export interface RecipientCounts {
  /** Everyone who will get the text by SMS. */
  total: number;
  /** By the language of the text they get; a language nobody gets is left out. */
  byLanguage: Readonly<Partial<Record<LangCode, number>>>;
}

/** Nobody: what texting reaches until E07 opens sign-up. */
export const NO_RECIPIENTS: RecipientCounts = { total: 0, byLanguage: {} };

const Count = z.number().int().min(0).max(COUNT_MAX);

/** The reviewed count as it travels in the approval form (a hidden field): versioned, strict, and its parts must add up. */
export const ReviewedCountsSchema = z
  .strictObject({ v: z.literal(1), total: Count, by_lang: z.partialRecord(LangCodeSchema, Count) })
  .refine((counts) => Object.values(counts.by_lang).reduce((sum, n) => sum + (n ?? 0), 0) === counts.total, "the languages must add up to the total");

/** The count as the form carries it. */
export function encodeCounts(counts: RecipientCounts): string {
  return JSON.stringify({ v: 1, total: counts.total, by_lang: Object.fromEntries(Object.entries(counts.byLanguage).filter(([, n]) => (n ?? 0) > 0)) });
}

/** The count a form carried, or null for anything that is not one (missing, malformed, a language that is not one, parts that do not add up). */
export function decodeCounts(text: unknown): RecipientCounts | null {
  if (typeof text !== "string" || text.length > 2000) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = ReviewedCountsSchema.safeParse(value);
  if (!parsed.success) return null;
  return { total: parsed.data.total, byLanguage: Object.fromEntries(Object.entries(parsed.data.by_lang).filter(([, n]) => (n ?? 0) > 0)) as RecipientCounts["byLanguage"] };
}

/** Whether two counts name the same number of people in every language (a language not listed has none). */
export function sameRecipientCounts(a: RecipientCounts, b: RecipientCounts): boolean {
  if (a.total !== b.total) return false;
  const langs = new Set([...Object.keys(a.byLanguage), ...Object.keys(b.byLanguage)]) as Set<LangCode>;
  for (const lang of langs) if ((a.byLanguage[lang] ?? 0) !== (b.byLanguage[lang] ?? 0)) return false;
  return true;
}
