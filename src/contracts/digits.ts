// Digits as residents type them (S07.02; S07.04 reads text replies with it too). A phone keyboard in Urdu, Pashto or Dari types Extended
// Arabic-Indic digits (۰-۹), in Arabic the Arabic-Indic ones (٠-٩), and Bengali, Devanagari, Gujarati, Gurmukhi and Tamil keyboards their
// own; some keyboards type full-width digits (０-９). Each is the same number. Pure and browser-safe.

const DECIMAL_DIGIT = /\p{Nd}/u;
const ANY_DECIMAL_DIGIT = /\p{Nd}/gu;

/** The value of one decimal digit: Unicode puts each script's digits 0 to 9 in a run of ten code points, so it is the offset in that run. */
function valueOf(digit: string): string {
  const code = digit.codePointAt(0)!;
  if (code <= 0x39) return digit;
  // Runs of ten can sit next to each other (the mathematical digits are five), and every run starts with its zero, so the offset from the
  // start of the whole stretch of digits, modulo ten, is the value.
  let start = code;
  while (start > 0 && DECIMAL_DIGIT.test(String.fromCodePoint(start - 1))) start -= 1;
  return String((code - start) % 10);
}

/** The text with every Unicode decimal digit (any script, full-width included) written as an ASCII digit 0-9; everything else unchanged. */
export function toAsciiDigits(text: string): string {
  return text.replace(ANY_DECIMAL_DIGIT, valueOf);
}
