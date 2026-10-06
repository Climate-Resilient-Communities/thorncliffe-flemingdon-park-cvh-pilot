// The catalog strings of the texts `subscriptions` sends a resident (AD-9: "every app-sent reply is a catalog string in the subscriber's
// language"), read from the generated catalogs of the 15 launch languages (design/prototype/cvh/strings.*.js -> npm run gen:strings).
// S07.02 adds the confirmation; S07.04 to S07.06 add the welcome, the menus (S07.05) and the edit link here. The keywords a resident replies with
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
  /** S07.04: after YES. Replies 1, 2, 3 (S07.05's menus) and 0, STOP, and the overnight notice (R-11). */
  welcome: "smsTexts.welcome",
  /** S07.04: YES from a number already subscribed. */
  alreadySignedUp: "smsTexts.alreadySignedUp",
  /** S07.04: reply 0 outside a menu, before the deletion. */
  deletePrompt: "smsTexts.deletePrompt",
  /** S07.04: the sign-up link, to a number with no subscription ({link} is the sign-up page in the language). */
  signupInfo: "smsTexts.signupInfo",
  /** S07.04: the words for yes a resident may reply with besides YES and Y, comma-separated (not a text that is sent). */
  yesWords: "smsKeywords.yes",
  // S07.05: the numbered menus. A page is a title, its options "1) ..." and the reserved replies (menuNav, or menuNavMore when a next page
  // exists); every one of these texts fits one segment in its language (subscriptions' menu fixture checks each, and every real page).
  /** Menu 1's page titles, the whole building's option, and menu 2's title. */
  menuStreet: "smsTexts.menuStreet",
  menuBuilding: "smsTexts.menuBuilding",
  menuFloor: "smsTexts.menuFloor",
  menuWholeBuilding: "smsTexts.menuWholeBuilding",
  menuLanguage: "smsTexts.menuLanguage",
  /** "0 Back, 9 Hub phone"; with "8 More" when there is a next page. */
  menuNav: "smsTexts.menuNav",
  menuNavMore: "smsTexts.menuNavMore",
  /** Menu 1 with more than one building saved: "This replaces your {n} saved buildings. 1 Continue, 0 Back". */
  menuWarn: "smsTexts.menuWarn",
  /** Reply 9 in a menu: the Hub's number ({hub}). */
  menuHub: "smsTexts.menuHub",
  /** 0 at a menu's first step: closed, nothing changed. */
  menuClosed: "smsTexts.menuClosed",
  /** A reply to a menu idle for 10 minutes: it has reset. */
  menuReset: "smsTexts.menuReset",
  /** Reply 1 or 2 at the daily menu limit: the Hub's number; with the edit link's offer ("Reply 1") once S07.06 sends the link. */
  menuLimit: "smsTexts.menuLimit",
  menuLimitLink: "smsTexts.menuLimitLink",
  /** Menu 1's confirmation: {building} (its address) and {floor} (its label), or the whole building. */
  buildingSaved: "smsTexts.buildingSaved",
  buildingSavedWhole: "smsTexts.buildingSavedWhole",
  /** Menu 2's confirmation, in the new language, naming it. */
  languageSaved: "smsTexts.languageSaved",
  /** Reply 3: no check-in request to withdraw (checkins' port says none: always, until E08), or the request withdrawn (S08.05). */
  noCheckinRequest: "smsTexts.noCheckinRequest",
  checkinWithdrawn: "smsTexts.checkinWithdrawn",
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
