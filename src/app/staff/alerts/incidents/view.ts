// What waits for a person and what they have in hand (S04.07's share of the Hub home, O-01; S04.10 builds the screen out, with the open threads and the
// drills in their own section). The view model, with every text already resolved from the English catalog.
//
// "Waiting for your approval" is for a Coordinator or an Admin: pending entries they did not edit, the longest wait first. "Running alerts" is for the roles
// that write to them (S05.01): the open threads residents are reading, each with "Add an update", or "Promote to full alert" while it is still only an
// acknowledgement, and (S05.02) "Correct" and "Withdraw" for the entries residents read; a closed thread is not listed, so none offers any. "Your alerts" is what the person is an editor of: a draft an approver sent back
// shows the approver's note until it is submitted again (the note's only other place is the composer). Drills are listed apart from real alerts and
// tagged, so a rehearsal is never mistaken for one.
import type { IncidentRow, Incidents, RunningThread } from "@/modules/alerting";
import type { StaffRole } from "@/contracts/staffRoles";
import { englishText } from "@/i18n/text";
import { formatTorontoDateTime } from "@/platform/clock";
import { approveHref, composerHref, correctHref, updateHref, withdrawHref } from "../pages";
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
  /** The approver's note, for a draft they sent back. */
  note: string | null;
  drill: boolean;
  link: { href: string; label: string };
  /** The other things to do with a running alert (S05.02): correct an entry, withdraw an entry. */
  more?: { href: string; label: string }[];
}

export interface IncidentsView {
  /** Only for a role that approves; null for the others (no section at all, not an empty one). */
  waiting: { title: string; lead: string; none: string; items: IncidentItemView[] } | null;
  /** Only for a role that writes alerts (S05.01); null for the others. Drills are in `drills`. */
  running: { title: string; lead: string; none: string; items: IncidentItemView[] } | null;
  mine: { title: string; none: string; items: IncidentItemView[] };
  drills: { title: string; items: IncidentItemView[] } | null;
}

const itemOf = (row: IncidentRow, kind: "waiting" | "mine", t: Text): IncidentItemView => {
  const ref = { alertId: row.alertId, entryId: row.entryId };
  const returned = row.status === "draft" && row.returnedNote !== null;
  return {
    key: `${kind}-${row.entryId}`,
    title: `${row.types.map(typeName).join(", ")} · ${t(`kind.${row.kind}`)}`,
    state: kind === "waiting" ? t("state.pending") : returned ? t("state.returned") : row.status === "draft" ? t("state.draft") : t("state.pending"),
    since: row.submittedAt ? t("waitingSince", { time: formatTorontoDateTime(row.submittedAt) }) : null,
    note: returned ? t("noteLabel", { note: row.returnedNote ?? "" }) : null,
    drill: row.isDrill,
    link:
      kind === "waiting"
        ? { href: approveHref(ref), label: t("review") }
        : // An update that follows other entries is written on the update composer, which sends it to "Promote" or "Add an update" as it belongs; a correction and a
          // withdrawal (S05.02) are written on their own.
          { href: composerHref(row.kind === "ack" ? "ack" : row.kind === "correction" ? "correct" : row.kind === "withdrawal" ? "withdraw" : row.followUp === true ? "update" : "compose", ref), label: t("open") },
  };
};

/** A running thread: what residents read last, until when, and the one way to add to it. */
const runningOf = (thread: RunningThread, t: Text): IncidentItemView => ({
  key: `running-${thread.alertId}`,
  title: thread.types.map(typeName).join(", "),
  state: t("runningLine", { kind: t(`kind.${thread.coveringKind}`), phase: englishText(`staff.compose.phase.${thread.phase}`), time: formatTorontoDateTime(thread.validUntil) }),
  since: t("runningPublished", { time: formatTorontoDateTime(thread.publishedAt) }),
  note: null,
  drill: thread.isDrill,
  link: { href: updateHref(thread.alertId, thread.ackOnly), label: thread.ackOnly ? t("promote") : t("addUpdate") },
  more: [
    { href: correctHref(thread.alertId), label: t("correct") },
    { href: withdrawHref(thread.alertId), label: t("withdraw") },
  ],
});

export function incidentsView(incidents: Incidents, role: StaffRole, t: Text = catalogText, running: readonly RunningThread[] = []): IncidentsView {
  const approver = role === "coordinator" || role === "admin";
  // The roles that write to a running alert are the ones that approve: Coordinators and Admins (the policy action alert.author_wide).
  const author = role === "coordinator" || role === "admin";
  const waiting = incidents.waiting.map((row) => itemOf(row, "waiting", t));
  const mine = incidents.mine.map((row) => itemOf(row, "mine", t));
  const runningItems = author ? running.map((thread) => runningOf(thread, t)) : [];
  const drills = [...waiting.filter((item) => item.drill), ...runningItems.filter((item) => item.drill), ...mine.filter((item) => item.drill)];
  return {
    waiting: approver ? { title: t("waitingTitle"), lead: t("waitingLead"), none: t("waitingNone"), items: waiting.filter((item) => !item.drill) } : null,
    running: author ? { title: t("runningTitle"), lead: t("runningLead"), none: t("runningNone"), items: runningItems.filter((item) => !item.drill) } : null,
    mine: { title: t("mineTitle"), none: t("mineNone"), items: mine.filter((item) => !item.drill) },
    drills: drills.length > 0 ? { title: t("drillsTitle"), items: drills } : null,
  };
}
