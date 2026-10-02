// What a resident reads of the guides and the essential numbers (S02.10, FR-D7): the rows the seed loaded
// (S02.09) laid out for one language. Pure: it reads nothing.
//
// A text the seed accepted in the language (reviewed and current) is shown in that language. Any other text is the
// checked English with `translation.unavailable`: it carries `unavailable: true` and `lang: "en"`, so the page can
// say so once and set the text itself left to right in English. A text is never blank and never machine-only.
import { GUIDE_SECTIONS } from "./guideContent";

/** Text key -> language -> text, as `guide.texts` and `essential_number.texts` keep them. */
export type ContentTexts = Record<string, Record<string, string>>;

export interface GuideRecord {
  id: string;
  readMins: number;
  /** YYYY-MM-DD */
  lastUpdated: string;
  texts: ContentTexts;
}

export interface NumberRecord {
  id: string;
  sortOrder: number;
  /** As the Hub writes it: "911", "416-542-8000", "(416) 421-8997". */
  number: string;
  emergency: boolean;
  /** YYYY-MM-DD: when the Hub's list was last updated. */
  lastUpdated: string;
  /** YYYY-MM-DD: when this number was last checked as correct. */
  lastChecked: string;
  texts: ContentTexts;
}

/** One text as it is shown. */
export interface ShownText {
  text: string;
  /** The language the text is written in: the page's language, or "en" when English stands in for it. */
  lang: string;
  /** True: English standing in for a missing, unreviewed or stale translation (`translation.unavailable`). */
  unavailable: boolean;
}

const filled = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** The text in this language, or the English with `translation.unavailable`; null when the key has no English at all. */
export function shownText(texts: ContentTexts, key: string, lang: string): ShownText | null {
  const entry = texts[key];
  if (!entry) return null;
  if (lang !== "en" && filled(entry[lang])) return { text: entry[lang], lang, unavailable: false };
  if (!filled(entry.en)) return null;
  return { text: entry.en, lang: "en", unavailable: lang !== "en" };
}

export type GuideSectionId = (typeof GUIDE_SECTIONS)[number];

export interface GuideView {
  id: string;
  readMins: number;
  lastUpdated: string;
  title: ShownText;
  /** "Call 911 if ...": never missing (the seed refuses a guide without it). */
  when911: ShownText;
  sections: Record<GuideSectionId, ShownText[]>;
  /** At least one text of the guide is English standing in for the language. */
  anyUnavailable: boolean;
  /** Every text of the guide is English standing in for the language. */
  allUnavailable: boolean;
}

/** The lines of a section, in order: `during.0`, `during.1`, ... */
function linesOf(texts: ContentTexts, section: GuideSectionId, lang: string): ShownText[] {
  const lines: { index: number; shown: ShownText }[] = [];
  for (const key of Object.keys(texts)) {
    const match = /^(before|during|after)\.([0-9]+)$/.exec(key);
    if (!match || match[1] !== section) continue;
    const shown = shownText(texts, key, lang);
    if (shown) lines.push({ index: Number(match[2]), shown });
  }
  return lines.sort((a, b) => a.index - b.index).map((line) => line.shown);
}

/** The guide in one language; null when the row lacks its title or its "when to call 911" (it then cannot be shown as a guide). */
export function guideView(record: GuideRecord, lang: string): GuideView | null {
  const title = shownText(record.texts, "title", lang);
  const when911 = shownText(record.texts, "when911", lang);
  if (!title || !when911) return null;
  const sections = Object.fromEntries(GUIDE_SECTIONS.map((section) => [section, linesOf(record.texts, section, lang)])) as Record<GuideSectionId, ShownText[]>;
  const all = [title, when911, ...GUIDE_SECTIONS.flatMap((section) => sections[section])];
  return {
    id: record.id,
    readMins: record.readMins,
    lastUpdated: record.lastUpdated,
    title,
    when911,
    sections,
    anyUnavailable: all.some((text) => text.unavailable),
    allUnavailable: all.every((text) => text.unavailable),
  };
}

/** The six guides' order in Be ready (the prototype's, data.js `hazards`); a guide not named here follows them, by id. */
export const GUIDE_ORDER = ["power", "flood", "elevator", "heat", "smoke", "fire"] as const;

export function orderGuides<T extends { id: string }>(guides: readonly T[]): T[] {
  const rank = (id: string) => {
    const at = (GUIDE_ORDER as readonly string[]).indexOf(id);
    return at === -1 ? GUIDE_ORDER.length : at;
  };
  return [...guides].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

export interface NumberView {
  id: string;
  /** As the Hub writes it. */
  number: string;
  /** What a `tel:` link dials: digits only, with +1 in front of a ten-digit number. */
  dial: string;
  emergency: boolean;
  label: ShownText;
  /** When to call it: the 911 number has one. */
  when: ShownText | null;
}

export interface NumbersView {
  /** The 911 row, shown apart; null when the list has none (the page then uses its own wording for 911). */
  emergency: NumberView | null;
  /** 211, 311, Toronto Hydro, the Hub, in the order the Hub keeps them. */
  others: NumberView[];
  /** YYYY-MM-DD: when the Hub's list was last updated; null when there are no rows. */
  lastUpdated: string | null;
  anyUnavailable: boolean;
}

/** What a `tel:` link dials: "416-542-8000" is +14165428000, "1 (416) 542-8000" too, "911" is 911. */
export function dialNumber(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  return digits.length === 11 && digits.startsWith("1") ? `+${digits}` : digits;
}

export function numbersView(records: readonly NumberRecord[], lang: string): NumbersView {
  const views: NumberView[] = [];
  for (const record of [...records].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const label = shownText(record.texts, "label", lang);
    if (!label) continue;
    views.push({ id: record.id, number: record.number, dial: dialNumber(record.number), emergency: record.emergency, label, when: shownText(record.texts, "when", lang) });
  }
  const emergency = views.find((view) => view.emergency) ?? null;
  const shown = views.filter((view) => view !== emergency);
  const dates = records.map((record) => record.lastUpdated).sort();
  return {
    emergency,
    others: shown,
    lastUpdated: dates.length > 0 ? dates[dates.length - 1] : null,
    anyUnavailable: views.some((view) => view.label.unavailable || view.when?.unavailable === true),
  };
}
