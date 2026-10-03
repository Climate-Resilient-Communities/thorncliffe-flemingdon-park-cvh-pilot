// The character rules of a text message (AD-21, S04.06): the fixed normalisation applied before a body is
// frozen, and the encoder that decides GSM-7 or UCS-2 and counts segments from that frozen body. Pure.
//
// The provider must send the frozen body byte for byte, so Twilio Smart Encoding is off on the Messaging
// Service (E06 checks it): every character change happens here, once, before the approver sees the text.

export type SmsEncoding = "gsm7" | "ucs2";

/** Twilio's limit for one message body, in characters (UTF-16 code units); longer is refused by the provider. */
export const SMS_MAX_BODY_LENGTH = 1600;

// ---------------------------------------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------------------------------------

/**
 * Typographic characters that have one plain, same-meaning substitute. Mapped to GSM-7 characters so that an
 * English or Latin-script text a person pasted from a word processor does not turn into a UCS-2 message (three
 * times the segments) because of a curly quote. Letters are never changed: an accent is part of the word, so
 * French, Spanish and Slovak bodies stay UCS-2 where they use an accent GSM-7 lacks (á í ó ú ê ç and others).
 */
export const NORMALISATION_TABLE: Readonly<Record<string, string>> = {
  // Apostrophes and single quotes.
  "\u2018": "'", // left single quotation mark
  "\u2019": "'", // right single quotation mark
  "\u201A": "'", // single low-9 quotation mark
  "\u201B": "'", // single high-reversed-9 quotation mark
  "\u2032": "'", // prime
  "\u02BC": "'", // modifier letter apostrophe
  "\u00B4": "'", // acute accent
  "`": "'", // grave accent
  "\uFF07": "'", // fullwidth apostrophe
  // Double quotes.
  "\u201C": '"', // left double quotation mark
  "\u201D": '"', // right double quotation mark
  "\u201E": '"', // double low-9 quotation mark
  "\u201F": '"', // double high-reversed-9 quotation mark
  "\u2033": '"', // double prime
  "\u00AB": '"', // left guillemet
  "\u00BB": '"', // right guillemet
  "\uFF02": '"', // fullwidth quotation mark
  // Hyphens, dashes and the minus sign.
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-", // en dash
  "\u2014": "-", // em dash
  "\u2015": "-", // horizontal bar
  "\u2212": "-", // minus sign
  // Ellipsis, bullet, arrows, multiplication sign.
  "\u2026": "...",
  "\u2022": "-", // bullet
  "\u2192": "->",
  "\u2190": "<-",
  "\u00D7": "x",
  // The degree sign is not GSM-7, and heat and winter alerts are full of "35°C": "35C" says the same.
  "\u00B0": "",
  // Spaces that are not the plain space.
  "\u00A0": " ", // no-break space
  "\u2002": " ",
  "\u2003": " ",
  "\u2004": " ",
  "\u2005": " ",
  "\u2006": " ",
  "\u2007": " ",
  "\u2008": " ",
  "\u2009": " ",
  "\u200A": " ",
  "\u202F": " ", // narrow no-break space
  "\u205F": " ",
  "\u3000": " ", // ideographic space
  "\t": " ",
  // Invisible characters that carry no meaning in a text message (the joiners and direction marks that
  // Persian, Urdu and the Indic scripts need are NOT here).
  "\u00AD": "", // soft hyphen
  "\u200B": "", // zero-width space
  "\u2060": "", // word joiner
  "\uFEFF": "", // byte order mark
  // Line separators.
  "\u2028": "\n",
  "\u2029": "\n",
  "\u0085": "\n", // next line
};

const MAPPED = new RegExp(`[${Object.keys(NORMALISATION_TABLE).map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")}]`, "g");
// Control characters other than the line feed (the table has already dealt with the tab and the line separators).
const CONTROLS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

/**
 * The one fixed normalisation of a body, applied before it is counted and frozen: Unicode NFC (an é typed as
 * "e" plus a combining accent is the one GSM-7 letter é, not two UCS-2 characters), line endings as "\n",
 * the table above, no other control characters, no spaces at the end of a line, at most one blank line in a row,
 * and nothing before or after the text. Idempotent. The same input gives the same output on every machine.
 */
export function normaliseSms(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(MAPPED, (c) => NORMALISATION_TABLE[c])
    .replace(CONTROLS, "")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------------------------------------
// Encoding and segments
// ---------------------------------------------------------------------------------------------------------

/**
 * The GSM 03.38 default alphabet, one septet each, in the order of its table. Position 27 (0x1B) is the escape
 * to the extension table, not a character, so the string has a placeholder there.
 */
const GSM7_DEFAULT_TABLE =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001BÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** The extension table: each of these is the escape plus one more septet, so two septets. */
const GSM7_EXTENSION = "\f^{}\\[~]|€";

const GSM7_BASIC = new Set([...GSM7_DEFAULT_TABLE].filter((c) => c !== "\u001B"));
const GSM7_EXTENDED = new Set([...GSM7_EXTENSION]);

/** The septets one character takes in GSM-7, or null when GSM-7 cannot carry it. */
function septets(character: string): 1 | 2 | null {
  if (GSM7_BASIC.has(character)) return 1;
  if (GSM7_EXTENDED.has(character)) return 2;
  return null;
}

export interface SmsCount {
  encoding: SmsEncoding;
  /** Septets (GSM-7, an extension character counting two) or UTF-16 code units (UCS-2). */
  units: number;
  /** Messages the provider sends: one up to 160 septets or 70 units, else parts of 153 septets or 67 units. */
  segments: number;
}

const GSM7_SINGLE = 160;
const GSM7_PART = 153;
const UCS2_SINGLE = 70;
const UCS2_PART = 67;

/** How many parts a body takes when each holds `capacity` units and a character of `size` units never splits across two. */
function parts(sizes: readonly number[], capacity: number): number {
  let count = 0;
  let free = 0;
  for (const size of sizes) {
    if (size > free) {
      count += 1;
      free = capacity;
    }
    free -= size;
  }
  return count;
}

/**
 * The encoding and the segments of a body, from the body itself (never from its source text). GSM-7 when every
 * character is in the default alphabet or its extension table; UCS-2 otherwise, where a character outside the
 * Basic Multilingual Plane (an emoji) is two code units. An extension character and a surrogate pair never split
 * across two parts. An empty body has no segments.
 */
export function countSms(body: string): SmsCount {
  const characters = [...body];
  const gsm = characters.map(septets);
  if (!gsm.includes(null)) {
    const sizes = gsm as number[];
    const units = sizes.reduce((sum, size) => sum + size, 0);
    return { encoding: "gsm7", units, segments: units === 0 ? 0 : units <= GSM7_SINGLE ? 1 : parts(sizes, GSM7_PART) };
  }
  const sizes = characters.map((c) => c.length);
  const units = sizes.reduce((sum, size) => sum + size, 0);
  return { encoding: "ucs2", units, segments: units <= UCS2_SINGLE ? 1 : parts(sizes, UCS2_PART) };
}
