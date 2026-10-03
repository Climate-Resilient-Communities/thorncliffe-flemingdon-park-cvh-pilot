// The catalog strings an alert's text message is made of (AD-21, S04.06), read from the generated catalogs of
// the 15 launch languages (design/prototype/cvh/strings.*.js -> npm run gen:strings). The renderer
// (messaging/domain/smsBody.ts) is the only reader: it takes no word from anywhere else.
//
// Every key below exists, translated, in all 15 catalogs (a test asserts it, so a key that falls back to
// English behind the visible "[EN]" marker is caught). The Hub's staff screens are English in the pilot, but a
// text message goes to a resident in the resident's own language.
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

/** Where each part of the body is in the catalog. `translation.unavailable` is `x04.unavailable` (AD-20). */
export const SMS_STRING_KEYS = {
  /** Part 1, drills only: "Exercise. Practice only." */
  exercise: "x10.sms",
  /** Part 2, corrections only. */
  correction: "R07.correction",
  /** Parts 3 and 8: the 911 line of a text message. */
  call911: "x01.sms",
  /** Part 4: "Verified by {org}". */
  verifiedBy: "x02.verifiedBy",
  /** Part 4: "Not yet verified". */
  notYetVerified: "x02.notYetVerified",
  /** The organisation that verifies: "the Hub" (mid-sentence form). */
  hub: "x02.hub",
  /** Part 5, a building ambassador's post: "Building ambassador, {building}". */
  ambassador: "x02.ambassador",
  /** Part 5, a Hub post: "Community alert from {author}". */
  community: "x02.community",
  /** Part 7: "Translated by machine". */
  machineLabel: "x04.label",
  /** Part 7 for a fallback: `translation.unavailable`, "Not yet available in this language". */
  unavailable: "x04.unavailable",
  /** Part 9: "More: {url}". */
  link: "R04.link",
  /** Part 10: "To stop all messages from the Hub, reply STOP." */
  stop: "R04.stop",
} as const;

export type SmsStrings = { readonly [K in keyof typeof SMS_STRING_KEYS]: string };

const CATALOGS: Readonly<Record<LaunchCode, unknown>> = { ur, ps, tl, prs, gu, ta, el, sk, bn, hi, pa, zh, es, fr, en };

function lookup(catalog: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node !== null && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), catalog);
}

const cache = new Map<LaunchCode, SmsStrings>();

/**
 * The strings of a text message in one launch language. Throws for a language that has no catalog (zh-Hant is a
 * web script variant, not a language a text is sent in) and for a key that is not a non-blank string.
 */
export function smsStrings(lang: LaunchCode): SmsStrings {
  const known = cache.get(lang);
  if (known) return known;
  const catalog = Object.prototype.hasOwnProperty.call(CATALOGS, lang) ? CATALOGS[lang] : undefined;
  if (catalog === undefined) throw new RangeError(`No text message catalog for language "${String(lang)}"`);
  const strings = {} as Record<string, string>;
  for (const [name, key] of Object.entries(SMS_STRING_KEYS)) {
    const value = lookup(catalog, key);
    if (typeof value !== "string" || value.trim() === "") throw new Error(`Catalog string "${key}" is missing or blank in "${lang}"`);
    strings[name] = value;
  }
  cache.set(lang, strings as SmsStrings);
  return strings as SmsStrings;
}

/** A catalog string with its `{name}` placeholders filled; a placeholder with no value is a bug, so it throws. */
export function fillSms(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`No value for the placeholder {${name}} of "${template}"`);
    return value;
  });
}
