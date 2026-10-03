// What a resident reads of an alert (R-03's card, R-07, R-28), worked out from the feed's thread as a pure function: the words come from
// the catalog through `t`, the times from the feed's own `server_now` (never the phone's clock), and nothing here is drawn. The components
// (alert-card.tsx, alert-detail.tsx, verified-explainer.tsx) only draw it, so the rules below are unit tests (alert-view.test.ts):
//  - the words of the type (X-13), the origin and verification (X-02) and the machine-translation label (X-04) are the catalog's, in the same
//    words wherever they appear;
//  - a text that is English standing in for a translation that failed (`fallback_en`) is set left to right in English and says so, in the
//    resident's language ("Not yet available in this language"); a machine translation carries its label and "Read it in English";
//  - the attribution is the Hub's whole sentence (R04.fromHub): "the Hub" is never joined to a preposition word by word (spine AD-21).
import { entriesNewestFirst, type FeedThread } from "@/contracts/feed";
import { isLaunchCode, languageOf, type LaunchCode } from "@/i18n/languages";
import { agoText } from "../home/feed-poll";
import { guideDuringHref, guidesFor } from "./guides";
import { validUntilLine, type Translate } from "./times";

export type { Translate } from "./times";

type FeedEntry = FeedThread["entries"][number];

/** The disruption types of the pilot (X-13); a type the catalog has no word for is read as "Other". */
export const TYPE_IDS = ["fire", "power", "water", "elevator", "flood", "heat", "smoke", "winter", "other"] as const;

export interface TypeView {
  id: (typeof TYPE_IDS)[number];
  word: string;
}

export interface TextView {
  body: string;
  /** The language the text is in, for `lang`: English for a fallback, whatever the page's language is. */
  lang: string;
  /** Left to right for English, the language's own direction for a translation. */
  dir: "ltr" | "rtl";
  /** English standing in for a translation that failed or was never made: set in English, with the note that says so. */
  fallback: boolean;
  /** A machine translation: it carries the label and "Read it in English". */
  machine: boolean;
}

export interface OriginView {
  /** "Community alert from the Hub": the Hub's whole sentence. */
  attribution: string;
  verified: boolean;
  /** "Verified by the Hub" or "Not yet verified": the same words on every surface (FR-A5). */
  verification: string;
  whatMeans: string;
}

export interface EntryView {
  id: string;
  /** The catalog's name for the kind of entry ("First message", "Update", ...). */
  kindLabel: string;
  /** "10 minutes ago", from the feed's clock. */
  time: string;
  text: TextView;
  /** The English the entry was written in, for "Read it in English"; null where the text is English already or it is not a machine translation. */
  english: string | null;
}

export interface AlertView {
  slug: string;
  types: TypeView[];
  /** The newest entry: what is true now. */
  current: EntryView;
  origin: OriginView;
  /** "Posted 10 minutes ago" or "Posted 10 minutes ago · Updated 2 minutes ago". */
  times: string;
  /** "Valid until today at 3:00 p.m.", or null when the time has passed. */
  valid: string | null;
  /** Said when the alert's time has passed and the thread is not closed yet: "This alert reached its end time without a final update." */
  ended: string | null;
  /** "Not yet available in this language". */
  unavailableTitle: string;
  /** "This has not been translated into اردو yet." */
  unavailableBody: string;
  /** "Read it in English". */
  showEnglish: string;
  /** "Original (English)". */
  originalLabel: string;
  /** The label and its "from English": the machine-translation mark (X-04). */
  machineLabel: string;
  machineFrom: string;
  guides: { id: string; label: string; href: string }[];
  /** Every entry, newest first (R-07's "Updates, newest first"); more than one only once the thread has an update. */
  entries: EntryView[];
}

const ENGLISH = languageOf("en");

/** The catalog's `x13` word for a type; "Other" for a type it has no word for. */
function typeOf(id: string, t: Translate): TypeView {
  const known = (TYPE_IDS as readonly string[]).includes(id) ? (id as TypeView["id"]) : "other";
  return { id: known, word: t(`x13.${known}`) };
}

/** `lang` and direction of a text: English reads as English, left to right; a translation as the language it is in. */
function textOf(entry: FeedEntry): TextView {
  const { text } = entry;
  const fallback = text.status === "fallback_en";
  if (fallback || text.lang === "en") return { body: text.body, lang: "en", dir: "ltr", fallback, machine: false };
  const language = isLaunchCode(text.lang) ? languageOf(text.lang) : undefined;
  return { body: text.body, lang: language?.bcp47 ?? text.lang, dir: language?.dir ?? "ltr", fallback: false, machine: text.machine };
}

function entryOf(entry: FeedEntry, serverNow: Date, t: Translate): EntryView {
  const text = textOf(entry);
  // SEAM(E05): a withdrawal reads as "Update" until E05 adds withdrawals and an R07.kinds.withdrawal string.
  const kinds: Record<string, string> = { ack: "ack", update: "update", correction: "correction", final: "final", withdrawal: "update" };
  const timeT: Translate = (key, values) => t(`time.${key}`, values);
  return {
    id: entry.id,
    kindLabel: t(`R07.kinds.${kinds[entry.kind] ?? "update"}`),
    time: agoText(serverNow.getTime() - new Date(entry.published_at).getTime(), timeT),
    text,
    english: text.machine ? entry.original.body : null,
  };
}

/** The origin and verification of an entry (X-02): who sent it, and whether the Hub checked it. */
export function originOf(entry: Pick<FeedEntry, "attribution" | "verified">, t: Translate): OriginView {
  return {
    // Only the Hub posts in this epic. An ambassador's post (E08) will be attributed to its building from the feed's `rsn`; until then a role
    // this page does not know is "a community alert", with no name of anyone.
    attribution: entry.attribution.role === "hub" ? t("R04.fromHub") : t("x02.levelCommunity"),
    verified: entry.verified,
    verification: entry.verified ? t("x02.verifiedBy", { org: t("x02.hub") }) : t("x02.notYetVerified"),
    whatMeans: t("x02.whatMeans"),
  };
}

/**
 * The view of a thread for a reader of `lang`. `serverNow` is the feed's `server_now`: every "ago" and the comparison with the valid-until
 * are measured against it, so a phone with a wrong clock reads the same words as everyone else.
 */
export function alertView(thread: FeedThread, input: { lang: LaunchCode; serverNow: Date; t: Translate }): AlertView {
  const { lang, serverNow, t } = input;
  const timeT: Translate = (key, values) => t(`time.${key}`, values);
  const language = languageOf(lang);
  // The feed carries the entries oldest first and does not refuse an order; R-07 reads them newest first, by their own times (S05.01).
  const newestFirst = entriesNewestFirst(thread.entries);
  const latest = newestFirst[0];
  const first = newestFirst[newestFirst.length - 1];
  const ago = (iso: string) => agoText(serverNow.getTime() - new Date(iso).getTime(), timeT);
  const times =
    newestFirst.length > 1 ? t("R07.timeLine", { posted: ago(first.published_at), updated: ago(latest.published_at) }) : t("R07.timeLineOne", { posted: ago(first.published_at) });
  const valid = validUntilLine(new Date(thread.valid_until), serverNow, language.bcp47, t);
  const lowerHazard = (guide: string) => t(`hazards.${guide}`).toLocaleLowerCase(language.bcp47);
  return {
    slug: thread.slug,
    types: thread.types.map((type) => typeOf(type, t)),
    current: entryOf(latest, serverNow, t),
    origin: originOf(latest, t),
    times,
    valid,
    ended: valid === null ? t("R07.expiredNote") : null,
    unavailableTitle: t("x04.unavailable"),
    unavailableBody: t("x04.unavailableBody", { lang: language.native }),
    showEnglish: t("x04.showSource", { lang: ENGLISH.native }),
    originalLabel: t("x04.original", { lang: ENGLISH.native }),
    machineLabel: t("x04.label"),
    machineFrom: t("x04.from", { lang: ENGLISH.native }),
    guides: guidesFor(thread.types).map((id) => ({ id, label: t("R07.guide", { hazard: lowerHazard(id) }), href: guideDuringHref(lang, id) })),
    entries: newestFirst.map((entry) => entryOf(entry, serverNow, t)),
  };
}
