// The monthly cap on text message spending (S07.08, AR-12, FR-G6): what an Admin may set, and what an approval is told. Pure.
//
// The cap WARNS and never blocks. For an approval the question is: would the month's spending so far, plus the texts already waiting to be sent,
// plus this entry's estimate, pass the cap? If so by how much (the shortfall the approver is shown before approving, and the overrun that is audited).
// Passing means MORE than the cap: spending that reaches the cap exactly is within it. Amounts are whole cents CAD.

/** The largest cap that can be set, in cents (CAD 100,000), and the smallest (one cent): the table's check says the same. */
export const SPEND_CAP_MAX_CENTS = 10_000_000;
export const SPEND_CAP_MIN_CENTS = 1;

export type CapProblem = "missing" | "not_a_number" | "too_small" | "too_large";

/**
 * The cap an Admin typed, in dollars (`250`, `250.50`, `1,250`, `$250`), as whole cents. At most two decimals; a thousands comma and a dollar sign
 * are allowed. Anything else is a problem the screen words; nothing is guessed.
 */
export function parseCapAmount(raw: unknown): { ok: true; cents: number } | { ok: false; problem: CapProblem } {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, problem: "missing" };
  const text = raw.trim().replace(/^\$/, "").replace(/\s+/g, "");
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(text)) return { ok: false, problem: "not_a_number" };
  const [whole, fraction = ""] = text.replace(/,/g, "").split(".");
  if (whole.length > 9) return { ok: false, problem: "too_large" };
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents < SPEND_CAP_MIN_CENTS) return { ok: false, problem: "too_small" };
  if (cents > SPEND_CAP_MAX_CENTS) return { ok: false, problem: "too_large" };
  return { ok: true, cents };
}

/** What the cap is judged against for one approval. */
export interface CapInput {
  /** The cap in cents; null while none is set (nothing can pass it). */
  capCents: number | null;
  /** The month's text message spending so far (actual where reconciled, estimates otherwise). */
  spentCents: number;
  /** Texts waiting to be sent whose estimate is not yet in the month's spending (they are counted once the provider accepts them). */
  queuedCents: number;
  /** This entry's own estimate. */
  estimateCents: number;
}

export interface CapAssessment extends CapInput {
  /** Spending after this entry's texts, as far as can be known. */
  projectedCents: number;
  /** By how much the cap would be passed; 0 when it is not (and when there is no cap). */
  overCents: number;
}

export function assessCap(input: CapInput): CapAssessment {
  const projectedCents = input.spentCents + input.queuedCents + input.estimateCents;
  const overCents = input.capCents === null ? 0 : Math.max(0, projectedCents - input.capCents);
  return { ...input, projectedCents, overCents };
}
