// What waits for a person and what they have in hand: the Hub home (O-01; S04.07 listed what waits, S04.10 builds the screen out). The view model, with
// every text already resolved from the English catalog.
//
// "Waiting for your approval" is for a Coordinator or an Admin: pending entries they did not edit, with how long each has waited, the longest wait first.
// "Running alerts" follows it: the open threads residents are reading, the most recently published first. A Coordinator or an Admin gets "Add an update"
// on each (S05.01), or "Promote to full alert" while it is still only an acknowledgement; a closed thread is not listed, so none offers either. A Director
// reads the same list and changes nothing (S01.12: the policy refuses every action to a Director, and the list carries no link to one). "Your alerts" is
// what the person is an editor of: a draft an approver sent back shows the approver's note until it is submitted again (the note's only other place is the
// composer). Drills are listed apart from real alerts, in their own labelled section, and tagged, so a rehearsal is never mistaken for one.
import type { IncidentRow, Incidents, RunningThread } from "@/modules/alerting";
import type { StaffRole } from "@/contracts/staffRoles";
import { englishText } from "@/i18n/text";
import { formatTorontoDateTime } from "@/platform/clock";
import { approveHref, COMPOSE_PAGE, composerHref, LOG_PAGE, updateHref } from "../pages";
import { typeName } from "../typeNames";

export type Text = (key: string, values?: Record<string, string | number>) => string;

/** The words of this panel: `staff.incidents.<key>` of the catalog. */
export const catalogText: Text = (key, values) => englishText(`staff.incidents.${key}`, values);

export interface IncidentItemView {
  key: string;
  /** "Elevator, Power · Acknowledgement". */
  title: string;
  /** Where it stands, in words. */
  state: string;
  /** "Submitted 2026-10-04 14:00" for a pending entry. */
  since: string | null;
  /** "Waiting 12 minutes", for an entry waiting for this person's approval. */
  waited: string | null;
  /** The approver's note, for a draft they sent back. */
  note: string | null;
  drill: boolean;
  /** Where the person goes next; null for a person who may not act on it (a Director reads the list and changes nothing). */
  link: { href: string; label: string } | null;
}

interface Section {
  title: string;
  lead: string;
  none: string;
  items: IncidentItemView[];
}

export interface IncidentsView {
  title: string;
  lead: string;
  /** "Read-only: ..." for a Director; null for the roles that act. */
  readOnly: string | null;
  /** The two ways to start (log a disruption, compose an alert), for the roles that may; null for the others. */
  start: { title: string; links: { id: "log" | "compose"; href: string; label: string }[] } | null;
  /** Only for a role that approves; null for the others (no section at all, not an empty one). */
  waiting: Section | null;
  /** The open threads: for a role that writes alerts (S05.01) and, read-only, for a Director; null for the others. Drills are in `drills`. */
  running: Section | null;
  mine: { title: string; none: string; items: IncidentItemView[] };
  /** Always present: its own labelled section, apart from the real alerts. */
  drills: Section;
}

/** How long, in words: "less than a minute", "12 minutes", "3 hours", "2 days". */
export function durationText(ms: number, t: Text): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const unit = (one: string, many: string, n: number) => (n === 1 ? t(`duration.${one}`) : t(`duration.${many}`, { n }));
  if (minutes < 1) return t("duration.justNow");
  if (minutes < 60) return unit("minute", "minutes", minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit("hour", "hours", hours);
  const days = Math.floor(hours / 24);
  return unit("day", "days", days);
}

const itemOf = (row: IncidentRow, kind: "waiting" | "mine", t: Text, now: Date): IncidentItemView => {
  const ref = { alertId: row.alertId, entryId: row.entryId };
  const returned = row.status === "draft" && row.returnedNote !== null;
  return {
    key: `${kind}-${row.entryId}`,
    title: `${row.types.map(typeName).join(", ")} · ${t(`kind.${row.kind}`)}`,
    state: kind === "waiting" ? t("state.pending") : returned ? t("state.returned") : row.status === "draft" ? t("state.draft") : t("state.pending"),
    since: row.submittedAt ? t("waitingSince", { time: formatTorontoDateTime(row.submittedAt) }) : null,
    waited: kind === "waiting" && row.submittedAt ? t("waitedFor", { time: durationText(now.getTime() - row.submittedAt.getTime(), t) }) : null,
    note: returned ? t("noteLabel", { note: row.returnedNote ?? "" }) : null,
    drill: row.isDrill,
    link:
      kind === "waiting"
        ? { href: approveHref(ref), label: t("review") }
        : // An update that follows other entries is written on the update composer, which sends it to "Promote" or "Add an update" as it belongs.
          { href: composerHref(row.kind === "ack" ? "ack" : row.followUp === true ? "update" : "compose", ref), label: t("open") },
  };
};

/** A running thread: what residents read last, until when, and the one way to add to it (none for a person who only reads). */
const runningOf = (thread: RunningThread, t: Text, readOnly: boolean): IncidentItemView => ({
  key: `running-${thread.alertId}`,
  title: thread.types.map(typeName).join(", "),
  state: t("runningLine", { kind: t(`kind.${thread.coveringKind}`), phase: englishText(`staff.compose.phase.${thread.phase}`), time: formatTorontoDateTime(thread.validUntil) }),
  since: t("runningPublished", { time: formatTorontoDateTime(thread.publishedAt) }),
  waited: null,
  note: null,
  drill: thread.isDrill,
  link: readOnly ? null : { href: updateHref(thread.alertId, thread.ackOnly), label: thread.ackOnly ? t("promote") : t("addUpdate") },
});

/** The Hub home for a person. `now` is when it is read: how long an entry has waited is counted to it. */
export function incidentsView(incidents: Incidents, role: StaffRole, t: Text = catalogText, running: readonly RunningThread[] = [], now: Date = new Date()): IncidentsView {
  // The roles that approve are the ones that write to a running alert: Coordinators and Admins (the policy actions alert.approve and alert.author_wide).
  const approver = role === "coordinator" || role === "admin";
  const author = approver;
  const director = role === "director";
  // Longest wait first; an entry with no submit time (never the case for a pending one) last.
  // A Director has nothing waiting and nothing of their own, and is handed no link to either, whatever rows they were given.
  const waiting = [...(director ? [] : incidents.waiting)]
    .sort((a, b) => (a.submittedAt?.getTime() ?? Infinity) - (b.submittedAt?.getTime() ?? Infinity))
    .map((row) => itemOf(row, "waiting", t, now));
  const mine = (director ? [] : incidents.mine).map((row) => itemOf(row, "mine", t, now));
  // Open threads, the most recently published first.
  const runningItems = author || director ? [...running].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).map((thread) => runningOf(thread, t, director)) : [];
  const drills = [...waiting.filter((item) => item.drill), ...runningItems.filter((item) => item.drill), ...mine.filter((item) => item.drill)];
  return {
    title: t("title"),
    lead: t("lead"),
    readOnly: director ? t("readOnly") : null,
    start: author
      ? {
          title: t("startNew"),
          links: [
            { id: "log", href: LOG_PAGE, label: t("logDisruption") },
            { id: "compose", href: COMPOSE_PAGE, label: t("compose") },
          ],
        }
      : null,
    waiting: approver ? { title: t("waitingTitle"), lead: t("waitingLead"), none: t("waitingNone"), items: waiting.filter((item) => !item.drill) } : null,
    running:
      author || director
        ? { title: t("runningTitle"), lead: director ? t("readOnlyRunningLead") : t("runningLead"), none: t("runningNone"), items: runningItems.filter((item) => !item.drill) }
        : null,
    mine: { title: t("mineTitle"), none: t("mineNone"), items: mine.filter((item) => !item.drill) },
    drills: { title: t("drillsTitle"), lead: t("drillsLead"), none: t("drillsNone"), items: drills },
  };
}
