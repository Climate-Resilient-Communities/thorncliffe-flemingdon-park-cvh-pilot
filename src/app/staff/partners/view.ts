// What the Hub's space screens show of a space (P-02's board, P-01, P-06, P-07), as words: pure, so the tests read the screens' sentences
// without a database. A status is always a word in a pill, never a colour alone; an open space nobody confirmed for 4 hours is flagged, as
// residents are told to call before they go (x09.unconfirmedNote).
import { isResidentStatus, isUnconfirmed, type LookBackRow, type SpaceChangeError, type SpaceRow, type SpaceStatus } from "@/modules/partners";
import { ago, clock, duration, ps, pw } from "./words";

/** The Hub's area of the partner space and its pages (the side navigation's "This disruption" and "Between disruptions"). */
export const PARTNER_PAGES = {
  space: "/staff/partners",
  open: "/staff/partners/open",
  coverage: "/staff/partners/coverage",
  capacity: "/staff/partners/capacity",
  ourSpaces: "/staff/partners/our-spaces",
  supplies: "/staff/partners/supplies",
  decisions: "/staff/partners/decisions",
  handover: "/staff/partners/handover",
  commitments: "/staff/readiness",
  playbooks: "/staff/readiness/playbooks",
  teams: "/staff/readiness/teams",
  exercise: "/staff/readiness/exercises",
  indicators: "/staff/readiness/indicators",
  lookBack: "/staff/readiness/look-back",
} as const;

export const spacePage = (id: string): string => `/staff/partners/spaces/${encodeURIComponent(id)}`;

/** One space as a card or a row of the board. */
export interface SpaceView {
  id: string;
  name: string;
  /** "Community room, 10 Gateway Boulevard". */
  where: string;
  /** "Run by TNO". */
  runBy: string;
  orgId: string;
  status: SpaceStatus;
  statusLabel: string;
  purposeLabel: string;
  /** "18 of 40 people now", or "Takes up to 45 people. Nobody has said how many are there now." */
  capacity: string;
  /** "Confirmed 20 minutes ago by Priya S., the Hub", or "Never confirmed". */
  confirmed: string;
  /** "Not confirmed for 7 hours" when an open space is overdue, else null. */
  unconfirmed: string | null;
  /** "Today 09:00 to 20:00", or null. */
  hours: string | null;
  /** Whether residents see it (open or full). */
  shown: boolean;
  /** At its limit but still open: P07.capAtMax. */
  atLimit: boolean;
  href: string;
}

export const statusLabel = (status: SpaceStatus): string => pw(`status.${status}`);
export const purposeLabel = (purpose: string): string => pw(`purpose.${purpose}`);

export function spaceView(space: SpaceRow, now: Date): SpaceView {
  const shown = isResidentStatus(space.status);
  const capacity =
    shown && space.capacityNow !== null
      ? ps("P04.spaceCap", { now: space.capacityNow, max: space.capacityMax })
      : shown
        ? ps("P04.spaceCapMax", { max: space.capacityMax })
        : pw("board.takesUpTo", { max: space.capacityMax });
  const confirmed =
    space.confirmedAt && space.confirmedBy ? pw("board.confirmed", { t: ago(space.confirmedAt, now), by: space.confirmedBy }) : pw("board.neverConfirmed");
  const unconfirmed = isUnconfirmed(space.status, space.confirmedAt, now)
    ? ps("P07.stale", { t: space.confirmedAt ? duration(now.getTime() - space.confirmedAt.getTime()) : pw("board.ever") })
    : null;
  return {
    id: space.id,
    name: space.name,
    where: [space.room, space.street].filter(Boolean).join(", "),
    runBy: ps("P04.spaceRunBy", { org: space.orgShortName }),
    orgId: space.orgId,
    status: space.status,
    statusLabel: statusLabel(space.status),
    purposeLabel: purposeLabel(space.purpose),
    capacity,
    confirmed,
    unconfirmed,
    hours: space.opensAt && space.closesAt && shown ? ps("x09.hoursToday", { from: space.opensAt, to: space.closesAt }) : null,
    shown,
    atLimit: space.status === "open" && space.capacityNow !== null && space.capacityNow >= space.capacityMax,
    href: spacePage(space.id),
  };
}

/** The notice a change leaves on the page it returns to (?space=&done= or ?space=&error=), read from the query; null for none. */
export type ChangeNotice = { kind: "done" | "refused"; spaceId: string; message: string };

export const CHANGE_ERRORS: readonly (SpaceChangeError | "not_found" | "forbidden")[] = [
  "status_unknown",
  "purpose_unknown",
  "capacity_max_invalid",
  "capacity_now_invalid",
  "capacity_over",
  "not_found",
  "forbidden",
];

export function changeNotice(query: { space?: string | string[]; done?: string | string[]; error?: string | string[] }, spaces: readonly SpaceRow[], now: Date): ChangeNotice | null {
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
  const spaceId = one(query.space);
  if (!spaceId) return null;
  const error = one(query.error);
  if (error) return CHANGE_ERRORS.includes(error as never) ? { kind: "refused", spaceId, message: pw(`errors.${error}`) } : null;
  if (one(query.done) !== "saved") return null;
  const space = spaces.find((s) => s.id === spaceId);
  if (!space) return null;
  return {
    kind: "done",
    spaceId,
    message: isResidentStatus(space.status)
      ? pw("done.shown", { name: space.name, status: statusLabel(space.status), time: space.confirmedAt ? clock(space.confirmedAt) : clock(now) })
      : pw("done.hidden", { name: space.name, status: statusLabel(space.status) }),
  };
}

/** Where a change goes back to: one of the area's own pages (the form says which), never anywhere else. */
export function backTo(value: unknown): string {
  if (typeof value !== "string") return PARTNER_PAGES.space;
  const [path, query = ""] = value.split("?", 2);
  const pages: string[] = Object.values(PARTNER_PAGES);
  const ok = pages.includes(path) || /^\/staff\/partners\/spaces\/SP[0-9]{2,4}$/.test(path);
  if (!ok) return PARTNER_PAGES.space;
  // Only the organisation of "Our spaces" is kept from the page's own query.
  const org = new URLSearchParams(query).get("org");
  return org && /^[A-Z][A-Z0-9]{1,9}$/.test(org) ? `${path}?org=${org}` : path;
}

/** The page to go back to with a change's notice. */
export function withNotice(back: string, spaceId: string, notice: { done: "saved" } | { error: string }): string {
  const url = new URL(back, "https://hub.invalid");
  url.searchParams.set("space", spaceId);
  if ("done" in notice) url.searchParams.set("done", notice.done);
  else url.searchParams.set("error", notice.error);
  return `${url.pathname}${url.search}#space-${spaceId}`;
}

/** A lesson that came up in more than one record (the same words), with the records it came up in: "Happened more than once". */
export function recurringLessons(records: readonly Pick<LookBackRow, "title" | "lessons">[]): { lesson: string; records: string[] }[] {
  const seen = new Map<string, string[]>();
  for (const record of records) for (const lesson of new Set(record.lessons)) seen.set(lesson, [...(seen.get(lesson) ?? []), record.title]);
  return [...seen].filter(([, titles]) => titles.length > 1).map(([lesson, titles]) => ({ lesson, records: titles }));
}

