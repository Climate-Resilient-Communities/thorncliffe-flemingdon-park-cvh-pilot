// What the Drills page shows (S06.05): the view model, with every text already resolved from the English catalog, so the component that draws it knows none of it
// and the layout tests can put the longest label in every place. Pure: no I/O. A drill's results are counts, ids and languages; a roster member is named by the label
// the Admin gave, never by number.
import { englishText } from "@/i18n/text";
import type { DrillThreadSummary } from "@/modules/alerting";
import type { DrillResultRow } from "@/modules/messaging";
import { formatTorontoDateTime } from "@/platform/clock";

/** The Drills page, the drill roster page and "Start a drill". */
export const DRILLS_PAGE = "/staff/drills";
export const DRILL_ROSTER_PAGE = "/staff/drills/roster";
export const DRILL_START_PAGE = "/staff/drills/start";

export type Text = (key: string, values?: Record<string, string | number>) => string;
export const drillsText: Text = (key, values) => englishText(`staff.drills.${key}`, values);

/** The language of a text in words: English, or the name the composer's language list gives (zh-Hant and the others). */
export function languageName(lang: string, text: Text = (key, values) => englishText(`staff.${key}`, values)): string {
  return lang === "en" ? text("drillRoster.english") : text(`compose.languageNames.${lang}`);
}

export interface DrillResultRowView {
  key: string;
  member: string;
  language: string;
  /** The five counts the Hub reads, each as "Handed off: 3". */
  counts: { id: "handedOff" | "delivered" | "undelivered" | "failed" | "unknown"; text: string }[];
}

export interface DrillView {
  id: string;
  heading: string;
  status: { id: "open" | "closed"; text: string };
  entries: string;
  results: {
    title: string;
    none: string | null;
    rows: DrillResultRowView[];
    waiting: string | null;
    notSent: string | null;
    unknownNote: string | null;
  };
}

export interface DrillsView {
  title: string;
  lead: string;
  start: { label: string; lead: string; href: string };
  roster: { summary: string; link: { label: string; href: string } };
  recent: { title: string; none: string | null; drills: DrillView[]; apart: string };
}

/** The roster's size in words. */
export function rosterSummary(size: number, t: Text = drillsText): string {
  if (size === 0) return t("roster.none");
  return size === 1 ? t("roster.one") : t("roster.many", { n: size });
}

const COUNTS = ["handedOff", "delivered", "undelivered", "failed", "unknown"] as const;

/** One drill, as the page shows it: when it was reported, whether it still runs, what was rehearsed, and what became of its texts per roster member and language. */
export function drillView(
  thread: DrillThreadSummary,
  results: readonly DrillResultRow[],
  labels: ReadonlyMap<string, string>,
  t: Text = drillsText,
  compose: Text = (key, values) => englishText(`staff.compose.${key}`, values),
): DrillView {
  const kinds = thread.entries.map((entry) => t("entryLine", { kind: compose(`thread.kind.${entry.kind}`), state: t(`entryState.${entry.status}`) }));
  // Members in the order of their label, then the removed ones, each member's languages in order.
  const rows = [...results].sort((a, b) => {
    const left = a.recipientId === null ? "￿" : (labels.get(a.recipientId) ?? "￿");
    const right = b.recipientId === null ? "￿" : (labels.get(b.recipientId) ?? "￿");
    return left.localeCompare(right) || a.lang.localeCompare(b.lang);
  });
  const sum = (pick: (row: DrillResultRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const waiting = sum((row) => row.waiting);
  const notSent = sum((row) => row.notSent);
  return {
    id: thread.id,
    heading: t("heading", { time: formatTorontoDateTime(thread.reportedAt) }),
    status: { id: thread.status, text: t(`status.${thread.status}`) },
    entries: t("entries", { entries: kinds.length === 0 ? "-" : kinds.join(", ") }),
    results: {
      title: t("results.title"),
      none: rows.length === 0 ? t("results.none") : null,
      rows: rows.map((row, index) => ({
        key: `${row.recipientId ?? "removed"}-${row.lang}-${index}`,
        member: row.recipientId === null ? t("results.removed") : (labels.get(row.recipientId) ?? t("results.removed")),
        language: languageName(row.lang),
        counts: COUNTS.map((id) => ({ id, text: t(`results.${id}`, { n: row[id] }) })),
      })),
      waiting: waiting > 0 ? t("results.waiting", { n: waiting }) : null,
      notSent: notSent > 0 ? t("results.notSent", { n: notSent }) : null,
      unknownNote: sum((row) => row.unknown) > 0 ? t("results.unknownNote") : null,
    },
  };
}

export function drillsView(input: { rosterSize: number; drills: readonly DrillView[]; text?: Text }): DrillsView {
  const t = input.text ?? drillsText;
  return {
    title: t("title"),
    lead: t("lead"),
    start: { label: t("start"), lead: t("startLead"), href: DRILL_START_PAGE },
    roster: { summary: rosterSummary(input.rosterSize, t), link: { label: t("rosterLink"), href: DRILL_ROSTER_PAGE } },
    recent: { title: t("recentTitle"), none: input.drills.length === 0 ? t("recentNone") : null, drills: [...input.drills], apart: t("results.apart") },
  };
}
