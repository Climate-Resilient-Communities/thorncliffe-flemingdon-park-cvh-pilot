import { displayPhone, phone } from "@/contracts/phone";

// A provider's contact lines are the Hub's own text, not a record: "(416)421-8997", "(416)363-6441 (Ext 211)",
// "(613)449-6705 & (647)984-8106 (Spanish)", "Emergency: 911 | City: 311 | Social Services: 211". This turns them into
// numbers a phone can dial, written the way the rest of the app writes them (displayPhone). The labels and notes stay
// as the Hub wrote them (English) inside the same left-to-right run as the number.

export type PhoneEntry = {
  /** What the resident reads: "Emergency: 911", "(416) 363-6441 (Ext 211)". */
  text: string;
  /** The number to put after `tel:`, or null when the text holds no number a phone can dial. */
  tel: string | null;
};

const SEGMENT = /^\s*(?:([A-Za-z][A-Za-z .'-]*?):\s*)?(\+?[\d(][\d\s().-]*)\s*(?:\(([^)]*)\))?\s*$/;

function entryOf(segment: string): PhoneEntry | null {
  const trimmed = segment.trim();
  if (trimmed === "") return null;
  const match = SEGMENT.exec(trimmed);
  if (!match) return { text: trimmed, tel: null };
  const [, label, number, note] = match;
  const { ok, digits } = phone(number);
  // A service number such as 911, 311 or 211 is dialled as it is; anything else must be a ten-digit North American number.
  const bare = number.replace(/\D/g, "");
  const tel = ok ? `+1${digits}` : /^[2-9]11$/.test(bare) ? bare : null;
  const shown = ok ? displayPhone(number) : number.trim();
  return { text: `${label ? `${label}: ` : ""}${shown}${note ? ` (${note.trim()})` : ""}`, tel };
}

/** Every number of a provider's phone lines, in order. A line holding several numbers ("|" or "&") gives one entry each. */
export function phoneEntries(lines: readonly string[]): PhoneEntry[] {
  return lines
    .flatMap((line) => line.split(/\s*\|\s*|\s+&\s+/))
    .map(entryOf)
    .filter((entry): entry is PhoneEntry => entry !== null);
}

/** The Hub's own words for a line of social handles ("X @name | Facebook @name"): one run each. */
export const socialEntries = (lines: readonly string[]): string[] =>
  lines
    .flatMap((line) => line.split(/\s*\|\s*/))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

/** A web address as a resident reads it (no scheme, no trailing slash) and the address to open; null when it is not an http(s) address. */
export function webEntry(address: string): { text: string; href: string } | null {
  try {
    const url = new URL(address.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { text: `${url.host}${url.pathname}${url.search}`.replace(/\/$/, ""), href: url.href };
  } catch {
    return null;
  }
}

type Contact = { phone: readonly string[]; email: readonly string[]; social: readonly string[]; web: readonly string[] };

/** True when the provider lists at least one way to get in touch. */
export const hasContact = (contact: Contact): boolean =>
  phoneEntries(contact.phone).length + contact.email.filter((e) => e.trim() !== "").length + socialEntries(contact.social).length + contact.web.filter((w) => webEntry(w) !== null).length > 0;

/** The Hub's own number (the Hub's contact in design/prototype/cvh/data.js), shown where the directory cannot load or a filter finds nothing. */
export const HUB_PHONE = "(416) 421-8997";
