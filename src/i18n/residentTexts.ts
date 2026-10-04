// The catalog strings of the texts `subscriptions` sends a resident (AD-9: "every app-sent reply is a catalog string in the subscriber's
// language"), read from the generated catalogs of the 15 launch languages (design/prototype/cvh/strings.*.js -> npm run gen:strings).
// S07.02 adds the confirmation; S07.04 to S07.06 add the welcome, the menus and the edit link here. The keywords a resident replies with
// (YES, STOP, START) stay in English in every language: they are what Twilio and the inbound router read.
//
// Every key below exists, translated, in all 15 catalogs (a test asserts it, so a key that falls back to English behind the "[EN]" marker
// is caught). Alert texts are not here: their words are messaging's renderer's alone (smsStrings.ts, AD-21).
import ur from "./messages/ur.json";
import ps from "./messages/ps.json";
import tl from "./messages/tl.json";
import prs from "./messages/prs.json";
import gu from "./messages/gu.json";
import ta from "./messages/ta.json";
import el from "./messages/el.json";
import sk from "./messages/sk.json";
import bn from "./messages/bn.json";
import hi from "./messages/hi.json";
import pa from "./messages/pa.json";
import zh from "./messages/zh.json";
import es from "./messages/es.json";
import fr from "./messages/fr.json";
import en from "./messages/en.json";
import type { LaunchCode } from "./languages";

/** Where each resident text is in the catalog. */
export const RESIDENT_TEXT_KEYS = {
  /** S07.02: the double opt-in, "Reply YES to get CVH alerts. Reply STOP to stop." */
  confirmation: "smsTexts.confirmation",
  /** S07.04: after YES. What replies 1, 2, 3 and 0 do, STOP, and the overnight notice (R-11). */
  welcome: "smsTexts.welcome",
  /** S07.04: YES from a number already subscribed. */
  alreadySignedUp: "smsTexts.alreadySignedUp",
  /** S07.04: reply 0 outside a menu, before the deletion. */
  deletePrompt: "smsTexts.deletePrompt",
  /** S07.04: the sign-up link, to a number with no subscription ({link} is the sign-up page in the language). */
  signupInfo: "smsTexts.signupInfo",
  /** S07.04: the words for yes a resident may reply with besides YES and Y, comma-separated (not a text that is sent). */
  yesWords: "smsKeywords.yes",
} as const;

export type ResidentTextName = keyof typeof RESIDENT_TEXT_KEYS;

const CATALOGS: Readonly<Record<LaunchCode, unknown>> = { ur, ps, tl, prs, gu, ta, el, sk, bn, hi, pa, zh, es, fr, en };

function lookup(catalog: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node !== null && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), catalog);
}

/**
 * One resident text in one launch language, as the catalog has it. Throws for a language that has no catalog (zh-Hant is a web script
 * variant, not a language a text is sent in) and for a key that is not a non-blank string.
 */
export function residentText(lang: LaunchCode, name: ResidentTextName): string {
  const catalog = Object.prototype.hasOwnProperty.call(CATALOGS, lang) ? CATALOGS[lang] : undefined;
  if (catalog === undefined) throw new RangeError(`No text message catalog for language "${String(lang)}"`);
  const key = RESIDENT_TEXT_KEYS[name];
  const value = lookup(catalog, key);
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Catalog string "${key}" is missing or blank in "${lang}"`);
  return value;
}
