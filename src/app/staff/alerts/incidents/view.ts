// What waits for a person and what they have in hand (S04.07's share of the Hub home, O-01; S04.10 builds the screen out, with the open threads and the
// drills in their own section). The view model, with every text already resolved from the English catalog.
//
// "Waiting for your approval" is for a Coordinator or an Admin: pending entries they did not edit, the longest wait first. "Your alerts" is what the
// person is an editor of: a draft an approver sent back shows the approver's note until it is submitted again (the note's only other place is the composer).
// Drills are listed apart from real alerts and tagged, so a rehearsal is never mistaken for one.
import type { IncidentRow, Incidents } from "@/modules/alerting";
import type { StaffRole } from "@/contracts/staffRoles";
import { englishText } from "@/i18n/text";
import { formatTorontoDateTime } from "@/platform/clock";
import { approveHref, composerHref } from "../pages";
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
}

export interface IncidentsView {
  /** Only for a role that approves; null for the others (no section at all, not an empty one). */
  waiting: { title: string; lead: string; none: string; items: IncidentItemView[] } | null;
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
        : { href: composerHref(row.kind === "ack" ? "ack" : "compose", ref), label: t("open") },
  };
};

export function incidentsView(incidents: Incidents, role: StaffRole, t: Text = catalogText): IncidentsView {
  const approver = role === "coordinator" || role === "admin";
  const waiting = incidents.waiting.map((row) => itemOf(row, "waiting", t));
  const mine = incidents.mine.map((row) => itemOf(row, "mine", t));
  const drills = [...waiting.filter((item) => item.drill), ...mine.filter((item) => item.drill)];
  return {
    waiting: approver ? { title: t("waitingTitle"), lead: t("waitingLead"), none: t("waitingNone"), items: waiting.filter((item) => !item.drill) } : null,
    mine: { title: t("mineTitle"), none: t("mineNone"), items: mine.filter((item) => !item.drill) },
    drills: drills.length > 0 ? { title: t("drillsTitle"), items: drills } : null,
  };
}
