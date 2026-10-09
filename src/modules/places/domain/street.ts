/**
 * The street of a building's address (S07.05): the SMS building menu lists streets first, then the buildings on the chosen street by
 * their number. An address as the register gives it, tidied (register.ts#tidyAddress), is a house number and a street: "85-95
 * Thorncliffe Park Dr" is number "85-95" on "Thorncliffe Park Dr". The number is the first word when it starts with a digit ("12", "85-95",
 * "2A"); an address with no such word is all street, with no number. Pure.
 */
export interface StreetAddress {
  /** The house number, or null when the address starts with no number. */
  number: string | null;
  /** The street, as the address writes it. */
  street: string;
}

export function streetOf(address: string): StreetAddress {
  const words = address.replace(/\s+/g, " ").trim().split(" ");
  if (words.length > 1 && /^[0-9]/.test(words[0]!)) return { number: words[0]!, street: words.slice(1).join(" ") };
  return { number: null, street: words.join(" ") };
}

const leadingNumber = (number: string | null): number => (number !== null && /^[0-9]+/.test(number) ? Number(/^[0-9]+/.exec(number)![0]) : Number.POSITIVE_INFINITY);
const byText = (a: string, b: string): number => a.localeCompare(b, "en", { sensitivity: "base", numeric: true });

/**
 * The order of building addresses in every list (UAT F-7): by street, then by house number as a number ("2" before "10", "85-95" at 85), so
 * "2 Grandstand Pl" is with Grandstand Pl and "10 Thorncliffe Park Dr" after "2 Thorncliffe Park Dr". An address with no number comes after the numbered
 * ones of its street. Ties (the same number) fall back to the whole number and then the address as text. Pure.
 */
export function compareAddresses(a: string, b: string): number {
  const left = streetOf(a);
  const right = streetOf(b);
  return byText(left.street, right.street) || leadingNumber(left.number) - leadingNumber(right.number) || byText(left.number ?? "", right.number ?? "") || byText(a, b);
}
