// The one builder of an alert's text message body (AD-21, S04.06). Every outbound SMS the app sends is built by
// this module; no other code assembles one, and a dependency rule keeps the SMS adapters inside `messaging`.
//
// `render(entry, lang, isDrill, slug, baseUrl)` returns the body in the language, in exactly this order, leaving
// out the parts that do not apply:
//   1. exercise marker (drills only)                  6. the text
//   2. correction marker (corrections only)           7. the machine-translation label (translated or fallback text)
//   3. the 911 line, here for fire, evacuation, Other  8. the 911 line, here for every other type
//   4. verification marker                            9. the /a/{slug} link
//   5. attribution                                   10. "Reply STOP"
// Every word comes from the catalog (src/i18n/smsStrings.ts). Exactly one 911 line is in every body. The body is
// normalised (smsEncoding.ts) and then counted, so what is stored is the final text and the count of that text.
//
// The public base URL (PUBLIC_BASE_URL, read through src/platform/config/env.ts by the composition root) comes in
// as an argument: domain code reads no environment and no clock.
import { SAFETY_OVERRIDE_TYPES } from "../../../contracts/audience";
import { LAUNCH_CODES, type LaunchCode } from "../../../i18n/languages";
import { fillSms, smsStrings } from "../../../i18n/smsStrings";
import { countSms, normaliseSms, type SmsEncoding } from "./smsEncoding";

/** What a frozen text message is: the body, how it is encoded and how many segments it takes. */
export interface RenderedSms {
  body: string;
  encoding: SmsEncoding;
  segments: number;
}

/**
 * One language's text of the entry as translation froze it (S04.02), in the structure the renderer needs and no
 * more: `fallback_en` means no translation passed its checks and the text is English; `machine` is true for a
 * machine translation, which is labelled. Alerting's FrozenTranslation fits this.
 */
export interface SmsTranslated {
  lang: string;
  body: string;
  status: "source" | "ok" | "translated" | "fallback_en" | "script_converted";
  machine: boolean;
}

/** Who the text message says the alert is from: the Hub, or a building ambassador of a named building (never a name). */
export type SmsAttribution = { role: "hub" } | { role: "ambassador"; building: string };

/** The entry as a text message needs it. */
export interface SmsEntry {
  kind: "ack" | "update" | "correction" | "withdrawal" | "final";
  /** Disruption type ids. */
  types: readonly string[];
  /** English, as the author wrote it. */
  text: string;
  /** "Verified by the Hub" when true, "Not yet verified" when false. */
  verified: boolean;
  attribution: SmsAttribution;
  /** The text in the other languages; a language with no row here is a fallback. */
  translations: readonly SmsTranslated[];
}

/**
 * The types whose alerts put the 911 line before everything but the exercise and correction markers: fire and
 * evacuation (the one `fire` type, "Fire alarm or evacuation", the same set that ignores topic opt-outs) and "Other".
 */
export const NINE_ONE_ONE_FIRST_TYPES: readonly string[] = [...SAFETY_OVERRIDE_TYPES, "other"];

export function isNineOneOneFirst(types: readonly string[]): boolean {
  return types.some((type) => NINE_ONE_ONE_FIRST_TYPES.includes(type));
}

const SLUG = /^[A-Za-z0-9_-]{1,64}$/;
const ORIGIN = /^https?:\/\/[^\s/?#]+$/;

/** The /a/{slug} link of an alert under the public origin (no trailing slash, no path). */
export function alertLink(baseUrl: string, slug: string): string {
  const origin = baseUrl.replace(/\/+$/, "");
  if (!ORIGIN.test(origin)) throw new RangeError("The public base URL must be an origin such as https://example.org");
  if (!SLUG.test(slug)) throw new RangeError("An alert slug is 1 to 64 letters, digits, hyphens or underscores");
  return `${origin}/a/${slug}`;
}

/** The text of the language and the label that goes with it (part 7), or the English with `translation.unavailable`. */
function textOf(entry: SmsEntry, lang: LaunchCode, strings: ReturnType<typeof smsStrings>): { text: string; label: string | null } {
  if (lang === "en") return { text: entry.text.trim(), label: null };
  const found = entry.translations.find((translation) => translation.lang === lang);
  // A missing row, a fallback and a blank body are all the same outcome: the resident gets the English, and the
  // text says in her language that it is not available in it. Never a blank text, never another language as hers.
  if (found === undefined || found.status === "fallback_en" || found.body.trim() === "") {
    return { text: entry.text.trim(), label: strings.unavailable };
  }
  return { text: found.body.trim(), label: found.machine ? strings.machineLabel : null };
}

/** The body of an alert's text message in one language, normalised, with its encoding and segment count. */
export function render(entry: SmsEntry, lang: LaunchCode, isDrill: boolean, slug: string, baseUrl: string): RenderedSms {
  const strings = smsStrings(lang);
  const link = alertLink(baseUrl, slug);
  const nineOneOneFirst = isNineOneOneFirst(entry.types);
  const { text, label } = textOf(entry, lang, strings);

  const lines: string[] = [];
  if (isDrill) lines.push(strings.exercise); // 1
  if (entry.kind === "correction") lines.push(strings.correction); // 2
  if (nineOneOneFirst) lines.push(strings.call911); // 3
  lines.push(entry.verified ? fillSms(strings.verifiedBy, { org: strings.hub }) : strings.notYetVerified); // 4
  lines.push(
    entry.attribution.role === "ambassador"
      ? fillSms(strings.ambassador, { building: entry.attribution.building })
      : fillSms(strings.community, { author: strings.hub }),
  ); // 5
  lines.push(text); // 6
  if (label !== null) lines.push(label); // 7
  if (!nineOneOneFirst) lines.push(strings.call911); // 8
  lines.push(fillSms(strings.link, { url: link })); // 9
  lines.push(strings.stop); // 10

  const body = normaliseSms(lines.join("\n"));
  const { encoding, segments } = countSms(body);
  return { body, encoding, segments };
}

/** The body in every launch language, keyed by language code (English included). */
export function renderAll(entry: SmsEntry, isDrill: boolean, slug: string, baseUrl: string): Record<LaunchCode, RenderedSms> {
  const bodies = {} as Record<LaunchCode, RenderedSms>;
  for (const lang of LAUNCH_CODES) bodies[lang] = render(entry, lang, isDrill, slug, baseUrl);
  return bodies;
}
