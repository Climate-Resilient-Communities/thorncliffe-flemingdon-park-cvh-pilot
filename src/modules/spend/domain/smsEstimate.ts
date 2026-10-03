// What the spend module records for a text message (S06.08, AD-8): one estimate per delivery, counted once, when the provider
// accepts the text or its outcome becomes `unknown`. Pure. Like every spend event it holds codes and numbers only: the delivery's id,
// the alert entry's id, a language code, the segments and the cost; never a phone number or a body.
import { z } from "zod";

/** The `kind` of a text message's spend event (the Cohere kinds are `embed` and `translate`). */
export const SMS_KIND = "sms";

/** The `model` column of a text message's event: it is the provider's service, not a model. */
export const SMS_MODEL = "twilio";

/** What the text was: an alert's, a transactional one (confirmation, reply, notice) or a campaign's. The delivery's own kind. */
export const SMS_ESTIMATE_PURPOSES = ["alert", "transactional", "campaign"] as const;
export type SmsEstimatePurpose = (typeof SMS_ESTIMATE_PURPOSES)[number];

/** The most segments a text can have (the delivery table's own limit, `delivery_segments_valid`). */
export const SMS_SEGMENTS_MAX = 24;

export const SmsEstimateSchema = z
  .strictObject({
    deliveryId: z.uuid(),
    /** The alert entry the text belongs to; null for a transactional or campaign text. */
    entryId: z.uuid().nullable(),
    lang: z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z]{2,8})?$/),
    /** Whether the text went to the drill roster (a drill entry reaches the roster only, and a real one never does). */
    isDrill: z.boolean(),
    segments: z.number().int().min(1).max(SMS_SEGMENTS_MAX),
    /** Segments x the configured price per segment, in whole cents CAD (rounded up). */
    costCents: z.number().int().min(0),
    purpose: z.enum(SMS_ESTIMATE_PURPOSES),
    /** When the estimate was made; the database's own clock when absent (production never gives it; tests do). */
    at: z.date().optional(),
  })
  .refine((estimate) => (estimate.entryId !== null) === (estimate.purpose === "alert"), { message: "an alert text names its entry and no other text does", path: ["entryId"] });

export type SmsEstimateInput = z.input<typeof SmsEstimateSchema>;
export type SmsEstimate = z.output<typeof SmsEstimateSchema>;

export class SmsEstimateError extends Error {
  override name = "SmsEstimateError";
}

/** Validates an estimate, or throws SmsEstimateError (a bug in the caller, not an input). */
export function toSmsEstimate(input: SmsEstimateInput): SmsEstimate {
  const parsed = SmsEstimateSchema.safeParse(input);
  if (!parsed.success) throw new SmsEstimateError(`sms estimate is invalid (${parsed.error.issues.map((issue) => issue.path.join(".") || "estimate").join(", ")})`);
  return parsed.data;
}
