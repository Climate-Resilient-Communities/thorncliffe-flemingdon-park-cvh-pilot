// Digits are Western (0-9) in every language until each community decides (prototype design note D-13, design/prototype/Notes.dc.html).
// A model may write a building number, a time or a phone number in its own script's digits (Arabic-Indic for Urdu and Dari,
// Extended Arabic-Indic for Pashto, Devanagari for Hindi, Bengali, Gurmukhi, Gujarati, Tamil ...); the text an alert freezes
// and sends carries them as 0-9. The same rule as `to_western` in scripts/translate_catalogue.py. Pure.
const DECIMAL = /^\p{Nd}$/u;

/**
 * The value of a decimal digit of any script. Unicode puts each script's ten digits in a run of consecutive code points in the
 * order 0 to 9 (and runs that follow one another, like the mathematical digits, are whole multiples of ten), so a digit's value is
 * its distance from the start of its run, modulo ten.
 */
function digitValue(codePoint: number): number {
  let start = codePoint;
  while (start > 0 && DECIMAL.test(String.fromCodePoint(start - 1))) start -= 1;
  return (codePoint - start) % 10;
}

/** The text with every Unicode decimal digit (category Nd, in any script) written as 0-9. Everything else is as it was. */
export function toWesternDigits(text: string): string {
  let out = "";
  for (const char of text) {
    out += char >= "0" && char <= "9" ? char : DECIMAL.test(char) ? String(digitValue(char.codePointAt(0)!)) : char;
  }
  return out;
}
