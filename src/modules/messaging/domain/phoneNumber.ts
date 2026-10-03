// Phone numbers in messaging (AD-13): a number is held only in memory, by the sender, from the hand-off point to the
// provider call, and a log line shows only its last two digits. No I/O and no clock.

/** An E.164 number: "+", a non-zero country code digit, then 7 to 14 more digits. */
const E164 = /^\+[1-9][0-9]{7,14}$/;

export function isE164(value: unknown): value is string {
  return typeof value === "string" && E164.test(value);
}

/**
 * A number for a log line: every digit but the last two is hidden, and the rest of the text (the plus sign, spaces,
 * brackets, dashes) stays: `+14165550101` is `+*********01`, `(416) 555-0101` is `(***) ***-**01`.
 */
export function maskForLog(value: string): string {
  const total = [...value].filter((char) => char >= "0" && char <= "9").length;
  let seen = 0;
  return [...value]
    .map((char) => {
      if (char < "0" || char > "9") return char;
      seen += 1;
      return seen > total - 2 ? char : "*";
    })
    .join("");
}

/**
 * Something that looks like a phone number: an international number written with a plus sign, or a North American
 * one with ten digits (an optional leading 1, brackets, spaces, dots or dashes between the groups). It must stand
 * alone, so a UUID, a Twilio SID and a longer run of digits are left as they are.
 */
const PHONE_LIKE = /(?<![\w-])(?:\+[0-9](?:[ ().-]?[0-9]){6,14}|(?:\+?1[ .-]?)?\(?[0-9]{3}\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4})(?![\w-])/g;

/** The text with every phone-number-like part masked to its last two digits (what a log line may carry of an error message). */
export function maskPhoneNumbers(text: string): string {
  return text.replace(PHONE_LIKE, (found) => maskForLog(found));
}

/** Whether a whole string reads as a phone number (so it cannot be an id or a key part that is meant to be opaque). */
export function looksLikePhoneNumber(value: string): boolean {
  const digits = value.replace(/[^0-9]/g, "");
  return /^\+?[0-9 ().-]+$/.test(value) && digits.length >= 7 && digits.length <= 15;
}
