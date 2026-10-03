// What the spend module records (AD-8, AD-10, AD-11): one event for every call to a paid vendor. Pure.
// Every field is a code or a number: there is no field that could hold a question, a provider's text or a phone
// number, and an event with any other field is refused.
import { z } from "zod";

const code = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

/**
 * What the call was for: a release's vectors, a resident's question (`search`, S03.04), a run of the search test set
 * (`test_set`), the translation of an alert's English text at submit (`alert`, S04.02).
 */
export const SPEND_PURPOSES = ["publish", "search", "test_set", "alert"] as const;

export type SpendPurpose = (typeof SPEND_PURPOSES)[number];

export const SpendEventSchema = z.strictObject({
  /** The kind of usage. S03.02 writes `embed`; later stories add their own. */
  kind: code,
  purpose: z.enum(SPEND_PURPOSES),
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  releaseV: z.number().int().positive().nullable().default(null),
  calls: z.number().int().min(1).default(1),
  /** The vendor's billed input tokens, or an estimate (then `tokensEstimated` says so). */
  tokens: z.number().int().min(0),
  tokensEstimated: z.boolean().default(false),
  ms: z.number().int().min(0).nullable().default(null),
  /** Null while the vendor's price is unknown: usage is then counted in calls and tokens only. */
  pricePerMillionTokensCad: z.number().min(0).nullable().default(null),
});
export type SpendEventInput = z.input<typeof SpendEventSchema>;
export type SpendEvent = z.output<typeof SpendEventSchema>;

export class SpendEventError extends Error {
  override name = "SpendEventError";
}

/** Validates an event, or throws SpendEventError (a bug in the caller, not an input). */
export function toSpendEvent(input: SpendEventInput): SpendEvent {
  const parsed = SpendEventSchema.safeParse(input);
  if (!parsed.success) throw new SpendEventError(`spend event is invalid (${parsed.error.issues.map((issue) => issue.path.join(".") || "event").join(", ")})`);
  return parsed.data;
}
