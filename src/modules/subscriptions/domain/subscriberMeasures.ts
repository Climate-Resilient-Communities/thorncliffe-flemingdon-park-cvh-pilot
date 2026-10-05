// The subscriber measures (S07.10, FR-M1 subscribers): the daily counts the Hub keeps of who is receiving texts, who is waiting to confirm and how many
// confirmed or left each day. Pure. Counts only, by language and neighbourhood, with no identifier of any kind; a group of 1 to 4 is shown as
// "fewer than 5" (the view `subscriber_measures` applies that rule, db/migrations/20261006100000_subscriber_measures.sql; nothing here adds to what it shows).

/** What is counted each day, in the order the Hub lists it. */
export const SUBSCRIBER_MEASURES = [
  "receiving_active",
  "receiving_reconsent_pending",
  "receiving_retained",
  "pending_signups",
  "confirmations",
  "deletions",
] as const;
export type SubscriberMeasure = (typeof SUBSCRIBER_MEASURES)[number];

export const isSubscriberMeasure = (value: string): value is SubscriberMeasure => (SUBSCRIBER_MEASURES as readonly string[]).includes(value);

/** The languages a subscriber can have (the 15 launch languages: `zh-Hant` is a text variant, not a choice a subscriber makes). */
export const SUBSCRIBER_LANGS = ["en", "ur", "ps", "tl", "prs", "gu", "ta", "el", "sk", "bn", "hi", "pa", "zh", "es", "fr"] as const;

/** What the view says in place of a count of 1 to 4 (E09 "Small-number rule"). */
export const FEWER_THAN_FIVE = "fewer than 5";

/** A count as the Hub shows it: the number, or null where the rule hides it, and the text to print either way. */
export interface ShownCount {
  n: number | null;
  shown: string;
}

/** One measure of one day, split by language and by neighbourhood, each with its total. */
export interface MeasureReading {
  measure: SubscriberMeasure;
  total: ShownCount;
  byLanguage: { lang: string; count: ShownCount }[];
  byNeighbourhood: { nbhd: string; count: ShownCount }[];
}

export interface SubscriberMeasuresDay {
  /** The Toronto day the figures are for, YYYY-MM-DD. */
  day: string;
  measures: MeasureReading[];
}

export interface MeasureViewRow {
  day: string;
  measure: string;
  split: string;
  key: string | null;
  n: number | null;
  nShown: string;
}

const count = (row: Pick<MeasureViewRow, "n" | "nShown">): ShownCount => ({ n: row.n, shown: row.nShown });

/** Groups the view's rows of one day into readings, in measure order, languages in launch order and neighbourhoods by id. */
export function readingsOf(rows: readonly MeasureViewRow[]): MeasureReading[] {
  const langOrder = (lang: string) => {
    const at = (SUBSCRIBER_LANGS as readonly string[]).indexOf(lang);
    return at === -1 ? SUBSCRIBER_LANGS.length : at;
  };
  const readings: MeasureReading[] = [];
  for (const measure of SUBSCRIBER_MEASURES) {
    const mine = rows.filter((row) => row.measure === measure);
    const total = mine.find((row) => row.split === "language" && row.key === null);
    if (!total) continue;
    readings.push({
      measure,
      total: count(total),
      byLanguage: mine
        .filter((row) => row.split === "language" && row.key !== null)
        .sort((a, b) => langOrder(a.key ?? "") - langOrder(b.key ?? "") || (a.key ?? "").localeCompare(b.key ?? ""))
        .map((row) => ({ lang: row.key ?? "", count: count(row) })),
      byNeighbourhood: mine
        .filter((row) => row.split === "neighbourhood" && row.key !== null)
        .sort((a, b) => (a.key ?? "").localeCompare(b.key ?? ""))
        .map((row) => ({ nbhd: row.key ?? "", count: count(row) })),
    });
  }
  return readings;
}

/** The days the job may record: the Toronto day just ended (the default) or the day still running. */
export type MeasuredDay = "yesterday" | "today";
