// What "Check-in rounds" (O-17, S08.08) and an escalation's page show, from the escalations as the app composes them (load.ts): pure, so the tests and the
// screenshots draw the very same words. Never a resident's number but on an escalation's page, for an Admin at aal2 (`resident.kind === "shown"`).
import type { EscalationStatus } from "@/modules/checkins";
import { englishText } from "@/i18n/text";
import { formatTorontoDateTime } from "@/platform/clock";

/** The Hub's list of escalations (O-17): the page the nav item "Check-in rounds" opens. */
export const ROUNDS_PAGE = "/staff/rounds";
/** An escalation's page, `?id=` the escalation (the link in the on-duty Admin's text; src/app/escalations.ts). */
export const ESCALATION_PAGE = "/staff/rounds/escalation";
/** The list renders again from the server this often, so an escalation marked while it is open appears without a reload. */
export const ROUNDS_REFRESH_SECONDS = 15;

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.rounds.${key}`, values);
const e = (key: string, values?: Record<string, string | number>) => englishText(`staff.rounds.escalation.${key}`, values);

/** An escalation with its words: the building's address, the floor's label and the staff members' names (null when an account is gone). */
export interface DescribedEscalation {
  id: string;
  status: EscalationStatus;
  building: string;
  floor: string;
  raisedBy: string | null;
  late: boolean;
  createdAt: Date;
  handled: { at: Date; by: string | null; note: string } | null;
}

export interface EscalationItemView {
  id: string;
  href: string;
  status: EscalationStatus;
  statusLabel: string;
  where: string;
  marked: string;
  from: string;
  /** A late mark's escalation: building, floor and ambassador only, and the Hub calls the ambassador. */
  late: string | null;
  handled: string | null;
  openLabel: string;
}

export interface RoundsScreen {
  open: EscalationItemView[];
  handled: EscalationItemView[];
  /** The escalations could not be read: the page says so. */
  unreadable: boolean;
}

export const escalationHref = (id: string) => `${ESCALATION_PAGE}?id=${encodeURIComponent(id)}`;
const nameOr = (name: string | null) => name ?? t("someone");
const whereOf = (escalation: Pick<DescribedEscalation, "building" | "floor">) => t("where", { building: escalation.building, floor: escalation.floor });

export function escalationItemView(escalation: DescribedEscalation): EscalationItemView {
  const statusLabel = t(`status.${escalation.status}`);
  const where = whereOf(escalation);
  return {
    id: escalation.id,
    href: escalationHref(escalation.id),
    status: escalation.status,
    statusLabel,
    where,
    marked: t("marked", { time: formatTorontoDateTime(escalation.createdAt) }),
    from: t("from", { name: nameOr(escalation.raisedBy) }),
    late: escalation.late ? t("late") : null,
    handled: escalation.handled ? t("handledBy", { name: nameOr(escalation.handled.by), time: formatTorontoDateTime(escalation.handled.at) }) : null,
    openLabel: t("openFor", { status: statusLabel, where }),
  };
}

/** The list: the open escalations first, then those handled (each newest first, as read). */
export function roundsScreen(escalations: readonly DescribedEscalation[]): RoundsScreen {
  const items = escalations.map(escalationItemView);
  return { open: items.filter((item) => item.handled === null), handled: items.filter((item) => item.handled !== null), unreadable: false };
}

export const unreadableRounds = (): RoundsScreen => ({ open: [], handled: [], unreadable: true });

// ---------------------------------------------------------------- an escalation's page

/** Who is looking: whether they may follow up (an Admin), and whether their session is at aal2 (the number is shown only then). */
export interface EscalationViewer {
  followUp: boolean;
  aal2: boolean;
}

/** The resident's details as the row an escalation is about still has them, composed by the app: only when the row names its subscriber. */
export type ResidentFacts = { kind: "linked"; phone: string | null; method: "call" | "text" } | { kind: "unlinked" };

export type ResidentView =
  | { kind: "shown"; phone: string; telHref: string; callLabel: string; floor: string; method: string; note: string }
  | { kind: "gone" | "admin_only" | "aal2"; text: string };

export interface EscalationScreen {
  kind: "escalation";
  id: string;
  title: string;
  back: { href: string; label: string };
  marked: string;
  late: string | null;
  /** Null for a late mark's escalation (building, floor and ambassador only). */
  resident: ResidentView | null;
  handled: { line: string; note: string } | null;
  /** The "Mark handled" form, for an Admin while it is open; otherwise the line that says who marks it. */
  form: { kind: "mark" } | { kind: "admin_marks"; text: string } | null;
}

export interface MissingEscalation {
  kind: "missing";
  message: string;
  back: { href: string; label: string };
}

const back = () => ({ href: ROUNDS_PAGE, label: e("back") });

export const missingEscalation = (): MissingEscalation => ({ kind: "missing", message: e("missing"), back: back() });

/** A `tel:` link of a number as it is stored (E.164): the digits and the plus sign only. */
const telOf = (phone: string) => `tel:${phone.replace(/[^+\d]/g, "")}`;

/**
 * The resident's part of an escalation's page (E08 "Escalation"): an Admin at aal2 sees the number, floor and method while the row names its subscriber;
 * an Admin sees that it is no longer kept once the row is a stub; anyone else sees that only an Admin sees it. A late mark's escalation has none.
 */
export function residentView(escalation: Pick<DescribedEscalation, "late" | "floor">, viewer: EscalationViewer, facts: ResidentFacts): ResidentView | null {
  if (escalation.late) return null;
  if (!viewer.followUp) return { kind: "admin_only", text: e("adminOnly") };
  if (!viewer.aal2) return { kind: "aal2", text: e("aal2") };
  if (facts.kind === "unlinked" || facts.phone === null) return { kind: "gone", text: e("residentGone") };
  return {
    kind: "shown",
    phone: facts.phone,
    telHref: telOf(facts.phone),
    callLabel: e("call", { phone: facts.phone }),
    floor: escalation.floor,
    method: e(`methods.${facts.method}`),
    note: e("residentNote"),
  };
}

export function escalationScreen(escalation: DescribedEscalation, viewer: EscalationViewer, facts: ResidentFacts): EscalationScreen {
  return {
    kind: "escalation",
    id: escalation.id,
    title: e("title", { status: t(`status.${escalation.status}`), where: whereOf(escalation) }),
    back: back(),
    marked: e("marked", { time: formatTorontoDateTime(escalation.createdAt), name: nameOr(escalation.raisedBy) }),
    late: escalation.late ? e("late") : null,
    resident: residentView(escalation, viewer, facts),
    handled: escalation.handled
      ? { line: e("handled", { name: nameOr(escalation.handled.by), time: formatTorontoDateTime(escalation.handled.at) }), note: e("handledNote", { note: escalation.handled.note }) }
      : null,
    form: escalation.handled ? null : viewer.followUp ? { kind: "mark" } : { kind: "admin_marks", text: e("adminMarks") },
  };
}
