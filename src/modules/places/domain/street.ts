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
