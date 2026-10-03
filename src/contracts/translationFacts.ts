// The facts an unreviewed machine translation must keep exactly (AD-11 pilot change, product owner 2026-10-03): the
// numbers, phone numbers, times, weekdays, emails and web addresses of the English, in the same order and as many times.
// Contact details and addresses are always shown from the catalogue's own fields; this keeps a machine description from
// contradicting them. The rule is strict on purpose: when a fact cannot be checked reliably, the text is refused and the
// English is shown. Pure and browser-safe.
//
// What is compared (after normalising both texts: any script's digits to 0-9, Unicode NFC, invisible formatting marks
// removed):
//  - every group of digits outside the times, as a sequence: the same groups, the same number of times, in the same
//    order (a swapped "Station 321 (231 McRae Dr)", a dropped copy of a repeated number, an added number all fail);
//  - every time, as a sequence: "9:30", "9am", "4:30 p.m." in the English. A time with a.m./p.m. must keep the same Latin
//    a.m./p.m., or be written in an unambiguous 24-hour form (13:45, 0:30, the French "13 h 45" and "9 h"); a time
//    without a.m./p.m. must stay as written and gain none. Local words for morning and evening are not read, so a
//    translation that relies on them is refused;
//  - every weekday, as a sequence of days: English names (Monday, Mon, Mondays) in the English, and in the translation
//    the English names plus the language's own weekday names (WEEKDAYS). Each language's table lists only words that
//    name a day; a word that also means something else ("Linggo" is also "week" in Tagalog, "ہفتہ" also "week" in
//    Urdu, "τρίτη" also "third" in Greek) can only add a day that is not in the English, which refuses the text;
//  - every phone number, postal code, email and web address of the English must be in the translation, and the
//    translation may have no email or web address the English does not have;
//  - a translation with a bidirectional embedding, override or isolate control (U+202A to U+202E, U+2066 to U+2069) is
//    refused outright: those can show digits in another order than they are stored. The marks that only set direction
//    (LRM, RLM, ALM) and zero-width characters are removed before comparing.
import type { LangCode } from "./lang";

const BIDI_CONTROLS = /[‪-‮⁦-⁩]/;
const INVISIBLE = /[­؜​-‏⁠﻿]/g;

/** Any script's digits as 0-9 (the catalogue keeps Western digits, D-13, but a model may still write others). */
export function toWesternDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (digit) => {
    const code = digit.codePointAt(0) as number;
    if (code >= 0x30 && code <= 0x39) return digit;
    // A run of decimal digits is made of blocks of ten, each starting at its zero: find the run's start.
    let start = code;
    while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start -= 1;
    return String((code - start) % 10);
  });
}

/** The text as it is compared: NFC, Western digits, no invisible formatting marks. */
const normalise = (text: string) => toWesternDigits(text.normalize("NFC")).replace(INVISIBLE, "");

// ---------------------------------------------------------------- tokens
const PHONE = /(?:\+?1[-\s])?\(?\d{3}\)?[-\s.]?\d{3}[-\s.]\d{4}(?:\s*(?:ext\.?|x)\s*\d+)?/gi;
const POSTAL = /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const WEB = /\b(?:https?:\/\/|www\.)[^\s,;)]+|\b[\w-]+\.(?:ca|com|org|net)\b(?:\/[^\s,;)]*)?/gi;
/**
 * A time: "9am", "9:30 a.m." (a.m./p.m. in any spelling), "9:30" or "9.30", and the French 24-hour "13 h 45", "13h45",
 * "9 h". The "h" form is read in the translation only.
 */
const TIME =
  /(?<![\d$.,])(\d{1,2})(?:[:.](\d{2}))?\s?([ap])\.?\s?m\b\.?|(?<![\d$.,])(\d{1,2})[:.](\d{2})(?![\d.,]\d|\s?\$)|(?<![\d$.,])(\d{1,2})\s?h(?:\s?(\d{2}))?(?![\p{L}\d])/giu;

interface Time {
  hour: number;
  minute: number;
  /** a.m. or p.m. as written in Latin letters; null when there is none. */
  meridiem: "a" | "p" | null;
  /** Written in the French 24-hour form ("13 h 45"). */
  hForm: boolean;
  text: string;
}

function times(text: string, readHForm: boolean): { times: Time[]; rest: string } {
  const found: Time[] = [];
  const rest = text.replace(TIME, (match, h1, m1, mer, h2, m2, h3, m3) => {
    if (h1 !== undefined) {
      found.push({ hour: Number(h1), minute: Number(m1 ?? 0), meridiem: (mer as string).toLowerCase() as "a" | "p", hForm: false, text: match });
    } else if (h2 !== undefined) {
      found.push({ hour: Number(h2), minute: Number(m2), meridiem: null, hForm: false, text: match });
    } else {
      // Only the French lower-case "h" ("13 h 45"); "4H" is a name, not a time.
      if (!readHForm || !/h/.test(match)) return match;
      found.push({ hour: Number(h3), minute: Number(m3 ?? 0), meridiem: null, hForm: true, text: match });
    }
    return " ";
  });
  return { times: found, rest };
}

/** The 24-hour value of a time with a.m./p.m., in minutes. */
const minutes24 = (time: Time) => ((time.hour % 12) + (time.meridiem === "p" ? 12 : 0)) * 60 + time.minute;

/** Whether a translated time says the same as the English one, with no room for a.m./p.m. to be read the other way. */
function sameTime(english: Time, translated: Time): boolean {
  if (english.meridiem === null) {
    return translated.meridiem === null && !translated.hForm && translated.hour === english.hour && translated.minute === english.minute;
  }
  if (translated.meridiem !== null) {
    return translated.meridiem === english.meridiem && translated.hour === english.hour && translated.minute === english.minute;
  }
  // No a.m./p.m. in the translation: only an unambiguous 24-hour time will do.
  const unambiguous = translated.hForm || translated.hour >= 13 || translated.hour === 0;
  return unambiguous && translated.hour < 24 && translated.hour * 60 + translated.minute === minutes24(english);
}

// ---------------------------------------------------------------- weekdays
/** Monday is 0. */
type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The English names: full names in any case (and plural), abbreviations capitalised only ("Sat", not "sat"). */
const ENGLISH_DAYS: readonly [Day, RegExp][] = [
  [0, /\b(?:[Mm]onday|MONDAY)s?\b|\bMon\b/],
  [1, /\b(?:[Tt]uesday|TUESDAY)s?\b|\bTues?\b/],
  [2, /\b(?:[Ww]ednesday|WEDNESDAY)s?\b|\bWed\b/],
  [3, /\b(?:[Tt]hursday|THURSDAY)s?\b|\bThu(?:rs?)?\b/],
  [4, /\b(?:[Ff]riday|FRIDAY)s?\b|\bFri\b/],
  [5, /\b(?:[Ss]aturday|SATURDAY)s?\b|\bSat\b/],
  [6, /\b(?:[Ss]unday|SUNDAY)s?\b|\bSun\b/],
];

const L = "[\\p{L}\\p{M}]";
/** A form in lower case, capitalised and in capitals (the check is case-sensitive, for the English abbreviations). */
const cased = (form: string) => [...new Set([form, form.charAt(0).toUpperCase() + form.slice(1), form.toUpperCase()])].join("|");
/** A word (or stem, `*` meaning any ending) of a language, in any case, not inside another word. */
const word = (form: string) =>
  form.endsWith("*") ? `(?<!${L})(?:${cased(form.slice(0, -1))})${L}*` : `(?<!${L})(?:${cased(form)})(?!${L})`;
/** A string matched wherever it is (scripts written without spaces between words, and compounds). */
const anywhere = (form: string) => form;

/**
 * Each language's weekday names, Monday first, the longer forms first. Persian-script compounds may be written with a
 * space or a zero-width non-joiner, which is removed before matching ("سه شنبه", "سه‌شنبه").
 */
const DAY_NAMES: Partial<Record<LangCode, readonly (readonly string[])[]>> = {
  fr: [["lundi", "lundis"], ["mardi", "mardis"], ["mercredi", "mercredis"], ["jeudi", "jeudis"], ["vendredi", "vendredis"], ["samedi", "samedis"], ["dimanche", "dimanches"]].map((d) => d.map(word)),
  es: [["lunes"], ["martes"], ["miércoles", "miercoles"], ["jueves"], ["viernes"], ["sábado", "sábados", "sabado", "sabados"], ["domingo", "domingos"]].map((d) => d.map(word)),
  tl: [["lunes"], ["martes"], ["miyerkules"], ["huwebes"], ["biyernes"], ["sabado"], ["linggo"]].map((d) => d.map(word)),
  sk: [
    ["pondel(?:ok|ka|ku|kom|ky|koch)"],
    ["utor(?:ok|ka|ku|kom|ky|koch)"],
    ["stred(?:a|u|y|e|ách|ami)"],
    ["štvrt(?:ok|ka|ku|kom|ky|koch)"],
    ["piat(?:ok|ka|ku|kom|ky|koch)"],
    ["sobot(?:a|u|y|e|ou|ách|ami)"],
    ["nede(?:ľ|l)(?:a|u|e|ou|ách|ami)", "nedieľ"],
  ].map((d) => d.map(word)),
  el: [["δευτέρα*", "δευτερα*"], ["τρίτη*", "τριτη*"], ["τετάρτη*", "τεταρτη*"], ["πέμπτη*", "πεμπτη*"], ["παρασκευή*", "παρασκευη*"], ["σάββατ*", "σαββατ*"], ["κυριακή*", "κυριακη*"]].map((d) => d.map(word)),
  zh: ["一", "二", "三", "四", "五", "六", "[日天]"].map((n) => [anywhere(`(?:星期|周|週|礼拜|禮拜)${n}`)]),
  "zh-Hant": ["一", "二", "三", "四", "五", "六", "[日天]"].map((n) => [anywhere(`(?:星期|周|週|礼拜|禮拜)${n}`)]),
  hi: [["सोमवार"], ["मंगलवार"], ["बुधवार"], ["गुरुवार", "बृहस्पतिवार"], ["शुक्रवार"], ["शनिवार"], ["रविवार", "इतवार"]].map((d) => d.map(anywhere)),
  pa: [["ਸੋਮਵਾਰ"], ["ਮੰਗਲਵਾਰ"], ["ਬੁੱਧਵਾਰ", "ਬੁਧਵਾਰ"], ["ਵੀਰਵਾਰ", "ਬ੍ਰਹਿਸਪਤੀਵਾਰ"], ["ਸ਼ੁੱਕਰਵਾਰ", "ਸ਼ੁਕਰਵਾਰ"], ["ਸ਼ਨੀਵਾਰ", "ਸ਼ਨਿੱਚਰਵਾਰ", "ਸ਼ਨਿਚਰਵਾਰ", "ਛਨਿੱਚਰਵਾਰ"], ["ਐਤਵਾਰ"]].map((d) => d.map((f) => anywhere(f.normalize("NFC")))),
  gu: [["સોમવાર"], ["મંગળવાર"], ["બુધવાર"], ["ગુરુવાર"], ["શુક્રવાર"], ["શનિવાર"], ["રવિવાર"]].map((d) => d.map(anywhere)),
  bn: [["সোমবার"], ["মঙ্গলবার"], ["বুধবার"], ["বৃহস্পতিবার"], ["শুক্রবার"], ["শনিবার"], ["রবিবার"]].map((d) => d.map(anywhere)),
  ta: [["திங்கள்"], ["செவ்வாய்"], ["புதன்"], ["வியாழ"], ["வெள்ளி"], ["சனி"], ["ஞாயிறு"]].map((d) => d.map(anywhere)),
  ur: [["پیر", "سوموار"], ["منگل"], ["بدھ"], ["جمعرات"], ["جمعہ", "جمعے"], ["ہفتہ", "ہفتے"], ["اتوار"]].map((d) => d.map(word)),
  // The Persian-style names the Pashto glossary records (glossary-ps.json), and the Pakistani پیر, منګل, اتوار.
  // Pashto inflects them: "تر جمعې", "له دوشنبې", so the final ه may be ې.
  ps: [
    ["دو ?شنب[هې]", "پیر"],
    ["سه ?شنب[هې]", "درې ?شنب[هې]", "منګل"],
    ["چهار ?شنب[هې]", "څلور ?شنب[هې]", "چارشنب[هې]"],
    ["پنج ?شنب[هې]", "پنځه ?شنب[هې]"],
    ["جمع[هې]"],
    ["شنب[هې]"],
    ["یک ?شنب[هې]", "یو ?شنب[هې]", "اتوار"],
  ].map((d) => d.map(word)),
  prs: [["دو ?شنبه"], ["سه ?شنبه"], ["چهار ?شنبه"], ["پنج ?شنبه"], ["جمعه"], ["شنبه"], ["یک ?شنبه"]].map((d) => d.map(word)),
};

/** The days a text names, in order. `lang` adds that language's names to the English ones. */
export function weekdays(text: string, lang: LangCode = "en"): Day[] {
  const flat = normalise(text).replace(/‌/g, " ");
  const alternatives: { day: Day; source: string }[] = ENGLISH_DAYS.map(([day, pattern]) => ({ day, source: pattern.source }));
  for (const [day, forms] of (DAY_NAMES[lang] ?? []).entries()) {
    for (const form of forms) alternatives.push({ day: day as Day, source: form });
  }
  // Longer forms first, so "سه شنبه" is one Tuesday and not a "شنبه" (Saturday), and "جمعرات" is not "جمعہ".
  alternatives.sort((a, b) => b.source.length - a.source.length);
  const pattern = new RegExp(alternatives.map((a) => `(${a.source})`).join("|"), "gu");
  const found: Day[] = [];
  for (const match of flat.matchAll(pattern)) {
    const at = match.slice(1).findIndex((group) => group !== undefined);
    found.push(alternatives[at].day);
  }
  return found;
}

// ---------------------------------------------------------------- the check
const all = (pattern: RegExp, text: string) => [...text.matchAll(pattern)].map((match) => match[0]);
const digitsOnly = (text: string) => text.replace(/\D/g, "");
const squash = (text: string) => text.toLowerCase().replace(/\s+/g, "");
const strip = (item: string) => item.replace(/\.$/, "");
const sameList = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((item, at) => item === b[at]);
const DAY_NAMES_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * The facts of the English a machine translation lost, changed, reordered or added (see the top of this file). An empty
 * list means every fact survived. `lang` is the translation's language, for its weekday names.
 */
export function lostFacts(english: string, translation: string, lang: LangCode = "en"): string[] {
  const lost: string[] = [];
  if (BIDI_CONTROLS.test(translation)) lost.push("a bidirectional control character that can reorder what is shown");
  const source = normalise(english);
  const text = normalise(translation);
  const flat = squash(text);

  const textDigits = digitsOnly(text);
  for (const phone of all(PHONE, source)) if (!textDigits.includes(digitsOnly(phone))) lost.push(`phone number ${phone}`);
  for (const postal of all(POSTAL, source)) if (!flat.includes(squash(postal))) lost.push(`postal code ${postal}`);
  const sourceEmails = all(EMAIL, source).map(strip);
  const sourceWebs = all(WEB, source).map(strip);
  for (const email of sourceEmails) if (!flat.includes(squash(email))) lost.push(`email ${email}`);
  for (const web of sourceWebs) if (!flat.includes(squash(web))) lost.push(`web address ${web}`);
  // Nothing invented: every email and web address of the translation is one of the English's.
  const known = new Set([...sourceEmails, ...sourceWebs].map(squash));
  const knownText = [...known].join(" ");
  for (const email of all(EMAIL, text).map(strip)) if (!known.has(squash(email))) lost.push(`email ${email} that the English does not have`);
  for (const web of all(WEB, text).map(strip)) {
    // A web address inside one of the English's (example.org inside https://example.org/help) is not new.
    if (!known.has(squash(web)) && !knownText.includes(squash(web))) lost.push(`web address ${web} that the English does not have`);
  }

  const sourceTimes = times(source, false);
  const textTimes = times(text, true);
  if (
    sourceTimes.times.length !== textTimes.times.length ||
    !sourceTimes.times.every((time, at) => sameTime(time, textTimes.times[at]))
  ) {
    lost.push(`times ${sourceTimes.times.map((t) => t.text.trim()).join(", ") || "(none)"} (the translation has ${textTimes.times.map((t) => t.text.trim()).join(", ") || "none"})`);
  }

  const sourceGroups = all(/\d+/g, sourceTimes.rest);
  const textGroups = all(/\d+/g, textTimes.rest);
  if (!sameList(sourceGroups, textGroups)) {
    lost.push(`numbers ${sourceGroups.join(" ") || "(none)"} (the translation has ${textGroups.join(" ") || "none"})`);
  }

  const sourceDays = weekdays(source, "en");
  const textDays = weekdays(text, lang);
  if (!sameList(sourceDays, textDays)) {
    const names = (days: Day[]) => days.map((day) => DAY_NAMES_EN[day]).join(", ") || "none";
    lost.push(`weekdays ${names(sourceDays)} (the translation has ${names(textDays)})`);
  }
  return [...new Set(lost)];
}
