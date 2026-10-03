// What an alert's author may write, as the rules both sides of the wire know (S04.05, AD-20): the text limit, the types of disruption in the
// order the screens list them, which of them are neighbourhood-wide, and the languages an alert is translated into. The alerting module's
// rules (alerting/domain/content.ts) and the Hub's screens (src/app/staff/alerts) both read them here, so a screen never needs the module's
// database code to say them. Pure and browser-safe.
import { LANG_CODES, type LangCode } from "./lang";

/** At most 600 characters of English text (epic E04, "Alert text limit"; a proposed engineering budget, not a PRD number). */
export const ALERT_TEXT_MAX = 600;

/** The types a building can have, in the order O-11 lists them. */
export const BUILDING_TYPES = ["power", "water", "elevator", "fire", "flood", "other"] as const;

/** Heat, smoke and winter storm: neighbourhood audience only, authored by Coordinators and Admins only. */
export const NEIGHBOURHOOD_ONLY_TYPES = ["heat", "smoke", "winter"] as const;

/** The languages an alert has a text for besides English: every launch language but English, and zh-Hant (converted from zh). */
export const TRANSLATED_LANGS: readonly Exclude<LangCode, "en">[] = LANG_CODES.filter((lang): lang is Exclude<LangCode, "en"> => lang !== "en");
