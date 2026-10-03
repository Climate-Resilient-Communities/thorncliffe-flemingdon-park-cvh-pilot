// An actual price from the provider, converted to Canadian dollars (S06.08). Pure, and exact: Twilio reports a price as a decimal string
// ("-0.00790", negative because it is a charge) in the account's currency (USD for the pilot's account), so the amount is read as an integer
// of 10^-8 units, multiplied by the rate as an integer of 10^-4, and rounded once, half up, to thousandths of a cent. No floating point
// touches an amount, so a thousand messages add up to exactly what the same thousand add up to in any order.

/** Thousandths of a cent CAD: 1,000 of them are a cent, 100,000 a dollar. */
export type Millicents = number;

const PRICE = /^(-?)([0-9]{1,9})(?:\.([0-9]{1,8}))?$/;
const UNIT = /^[A-Z]{3}$/;
const DECIMALS = 8;
const RATE_SCALE = 10_000;

export type CadConversion =
  | {
      ok: true;
      /** The price as the provider reported it, kept as it came. */
      priceText: string;
      /** The currency the provider reported. */
      unit: string;
      /** CAD per unit of that currency the amount was converted at (1 for CAD). */
      rate: number;
      millicents: Millicents;
    }
  | { ok: false; reason: "no_price" | "price_unusable" };

/** A rate (CAD per US dollar) as a whole number of ten-thousandths; throws for one that is not positive with at most four decimals. */
export function rateInTenThousandths(rate: number): number {
  const scaled = Math.round(rate * RATE_SCALE);
  if (!Number.isFinite(rate) || rate <= 0 || Math.abs(rate * RATE_SCALE - scaled) > 1e-6) {
    throw new RangeError("The exchange rate must be a positive number with at most four decimals");
  }
  return scaled;
}

/**
 * The CAD amount, in thousandths of a cent, of a price the provider reported. A message with no price yet (null, empty) is `no_price`;
 * an amount that is not a plain decimal, or a currency this app has no rate for (it converts USD at `usdToCad` and takes CAD as is), is
 * `price_unusable`. The provider's sign is dropped: a price is what the message cost.
 */
export function toCadMillicents(price: string | null | undefined, unit: string | null | undefined, usdToCad: number): CadConversion {
  if (price === null || price === undefined || price.trim() === "") return { ok: false, reason: "no_price" };
  const text = price.trim();
  const match = PRICE.exec(text);
  if (!match) return { ok: false, reason: "price_unusable" };
  const currency = (unit ?? "").trim().toUpperCase();
  if (!UNIT.test(currency)) return { ok: false, reason: "price_unusable" };
  let rate: number;
  if (currency === "CAD") rate = 1;
  else if (currency === "USD") rate = usdToCad;
  else return { ok: false, reason: "price_unusable" };

  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? "").padEnd(DECIMALS, "0") || "0");
  const amount = whole * BigInt(10 ** DECIMALS) + fraction;
  // amount x 10^-8 units, times rate x 10^-4, in thousandths of a cent (x 10^5): amount x rate / 10^7, rounded half up.
  const millicents = (amount * BigInt(rateInTenThousandths(rate)) + BigInt(5_000_000)) / BigInt(10_000_000);
  if (millicents > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, reason: "price_unusable" };
  return { ok: true, priceText: text, unit: currency, rate, millicents: Number(millicents) };
}

/** Thousandths of a cent as cents CAD (a number with at most three decimals, exact for any amount this app can hold). */
export const centsOf = (millicents: Millicents): number => millicents / 1000;
