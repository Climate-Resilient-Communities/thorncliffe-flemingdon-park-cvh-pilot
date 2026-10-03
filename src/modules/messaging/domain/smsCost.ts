// The estimated cost of an alert's text messages (AD-21, S04.06): segments x recipients x the configured price per
// segment, in whole cents CAD. An estimate, always: the provider's invoice is what it is. Pure.
//
// The price is configured in cents CAD with up to three decimals (SMS_PRICE_PER_SEGMENT_CENTS, a segment costs
// about a cent and a quarter), so the sum is done in integer thousandths of a cent and rounded UP to the next
// whole cent: an estimate may overstate by less than a cent, never understate.

/** Which recipient count the estimate used: the preview's at submit, the approval's snapshot at approval. */
export type CostBasis = "preview" | "snapshot";

export interface SmsCostEstimate {
  /** Always true: the figure is shown labelled as an estimate. */
  estimate: true;
  basis: CostBasis;
  /** Whole cents CAD. */
  cents: number;
  /** Segments to send in all: the sum over languages of segments x recipients. */
  segments: number;
  /** Per language: recipients, segments in each text and the segments to send. */
  byLanguage: Readonly<Record<string, { recipients: number; segmentsEach: number; segments: number }>>;
}

export interface SmsCostInput {
  /** Segments of each language's frozen body. */
  segmentsByLanguage: Readonly<Record<string, number>>;
  /** Recipients of each language; a language not listed has none. */
  recipientsByLanguage: Readonly<Record<string, number>>;
  /** Cents CAD per segment (at most three decimals). */
  pricePerSegmentCents: number;
  basis: CostBasis;
}

const THOUSANDTHS = 1000;

/** The price in thousandths of a cent, exactly; throws for a price that is not a positive number of at most three decimals. */
export function priceInThousandthsOfCent(cents: number): number {
  const scaled = Math.round(cents * THOUSANDTHS);
  if (!Number.isFinite(cents) || cents <= 0 || Math.abs(cents * THOUSANDTHS - scaled) > 1e-6) {
    throw new RangeError("The price per segment must be a positive number of cents with at most three decimals");
  }
  return scaled;
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** segments x recipients x price, per language and in all, as whole cents CAD rounded up. */
export function estimateSmsCost(input: SmsCostInput): SmsCostEstimate {
  const price = priceInThousandthsOfCent(input.pricePerSegmentCents);
  const byLanguage: Record<string, { recipients: number; segmentsEach: number; segments: number }> = {};
  let segments = 0;
  for (const lang of new Set([...Object.keys(input.recipientsByLanguage), ...Object.keys(input.segmentsByLanguage)])) {
    const recipients = input.recipientsByLanguage[lang] ?? 0;
    const segmentsEach = input.segmentsByLanguage[lang];
    if (!isCount(recipients)) throw new RangeError(`Recipients of "${lang}" must be a whole number, not negative`);
    if (recipients === 0 && segmentsEach === undefined) continue;
    // A language with recipients must have a frozen body to count: sending it a text nobody rendered is a bug.
    if (!isCount(segmentsEach)) throw new RangeError(`No segment count for "${lang}", which has recipients`);
    byLanguage[lang] = { recipients, segmentsEach, segments: recipients * segmentsEach };
    segments += recipients * segmentsEach;
  }
  if (!Number.isSafeInteger(segments * price)) throw new RangeError("The estimate is too large to count");
  return { estimate: true, basis: input.basis, cents: Math.ceil((segments * price) / THOUSANDTHS), segments, byLanguage };
}
