// A space partners open for residents in a disruption (PRD §6.3 F-space, the prototype's P-01, P-06, P-07 and the resident's x09 status), as
// rules without I/O. The database's checks (db/migrations/20261107110000_partner_space.sql) hold the same rules under these, for a script or a
// query run by hand; this is what the Hub's forms answer with, word for word.

/** What a space is for: the prototype's x09 purposes, in the database's words. */
export const SPACE_PURPOSES = ["cooling", "warming", "clean_air", "charging"] as const;
export type SpacePurpose = (typeof SPACE_PURPOSES)[number];

/**
 * Where a space stands. `open` and `full` are what residents see (a full space is shown, so nobody walks there for nothing); `closed` was open
 * in this disruption and is not now; `not_activated` is a space a partner can open that nobody has opened.
 */
export const SPACE_STATUSES = ["open", "full", "closed", "not_activated"] as const;
export type SpaceStatus = (typeof SPACE_STATUSES)[number];

/** The statuses residents are shown (the map's "Open as a space now", the listing): the others are left out of GET /api/spaces. */
export const RESIDENT_STATUSES = ["open", "full"] as const satisfies readonly SpaceStatus[];
export type ResidentSpaceStatus = (typeof RESIDENT_STATUSES)[number];

export const isResidentStatus = (status: SpaceStatus): status is ResidentSpaceStatus => (RESIDENT_STATUSES as readonly string[]).includes(status);

/** The largest room a space can be (the database's `space_capacity_max_range`): an arena lobby, not a stadium. */
export const MAX_CAPACITY = 2000;

/**
 * After this long without a confirmation an open space is "Not confirmed" (the prototype's `unconfirmedAfterMins`, 240): the Hub's board flags
 * it and the resident is told to call before going (x09.unconfirmedNote).
 */
export const UNCONFIRMED_AFTER_MINUTES = 240;

export const isSpacePurpose = (value: unknown): value is SpacePurpose => typeof value === "string" && (SPACE_PURPOSES as readonly string[]).includes(value);
export const isSpaceStatus = (value: unknown): value is SpaceStatus => typeof value === "string" && (SPACE_STATUSES as readonly string[]).includes(value);

/** A space as a change starts from and ends at. */
export interface SpaceState {
  status: SpaceStatus;
  purpose: SpacePurpose;
  capacityMax: number;
  /** People there now; null when nobody counted. */
  capacityNow: number | null;
}

/** What a Hub form asks for: every field as the form sent it (strings), so the decision says what was wrong with which. */
export interface SpaceChangeInput {
  status: string;
  purpose: string;
  capacityMax: string;
  /** Blank when nobody counted. */
  capacityNow: string;
}

export const SPACE_CHANGE_ERRORS = ["status_unknown", "purpose_unknown", "capacity_max_invalid", "capacity_now_invalid", "capacity_over"] as const;
export type SpaceChangeError = (typeof SPACE_CHANGE_ERRORS)[number];

export type SpaceDecision = { ok: true; next: SpaceState } | { ok: false; error: SpaceChangeError };

const WHOLE = /^\d{1,6}$/;

/**
 * Decides a change of a space from the Hub's form (P-01 open a space, P-06 the activation, P-07's buttons). Every change, even one that sets
 * the same values, confirms the space as it stands (the prototype's "Setting a state also confirms"), so it is never refused for changing
 * nothing. A space that is not open or full has nobody counted in it: its count is dropped, whatever the form sent. A count above the room's
 * limit is refused (a full room is `full`, not 60 of 50).
 */
export function decideSpaceChange(input: SpaceChangeInput): SpaceDecision {
  const status = input.status.trim();
  const purpose = input.purpose.trim();
  if (!isSpaceStatus(status)) return { ok: false, error: "status_unknown" };
  if (!isSpacePurpose(purpose)) return { ok: false, error: "purpose_unknown" };
  const max = input.capacityMax.trim();
  if (!WHOLE.test(max) || Number(max) < 1 || Number(max) > MAX_CAPACITY) return { ok: false, error: "capacity_max_invalid" };
  const capacityMax = Number(max);
  const now = input.capacityNow.trim();
  let capacityNow: number | null = null;
  if (isResidentStatus(status) && now !== "") {
    if (!WHOLE.test(now)) return { ok: false, error: "capacity_now_invalid" };
    capacityNow = Number(now);
    if (capacityNow > capacityMax) return { ok: false, error: "capacity_over" };
  }
  return { ok: true, next: { status, purpose, capacityMax, capacityNow } };
}

/** A quick status change (P-07's Open / Full / Closed buttons): the space's purpose and capacity as they are, the count dropped when it closes. */
export function withStatus(current: SpaceState, status: SpaceStatus): SpaceChangeInput {
  return {
    status,
    purpose: current.purpose,
    capacityMax: String(current.capacityMax),
    capacityNow: isResidentStatus(status) && current.capacityNow !== null ? String(current.capacityNow) : "",
  };
}

/** True when an open or full space was last confirmed longer ago than UNCONFIRMED_AFTER_MINUTES (or never). */
export function isUnconfirmed(status: SpaceStatus, confirmedAt: Date | null, now: Date): boolean {
  if (!isResidentStatus(status)) return false;
  if (confirmedAt === null) return true;
  return now.getTime() - confirmedAt.getTime() > UNCONFIRMED_AFTER_MINUTES * 60_000;
}

/** The board's counts (P-02, P-05): how many spaces are in each status, and the people in the open and full ones against their limits. */
export interface SpaceTotals {
  byStatus: Record<SpaceStatus, number>;
  /** People counted in open and full spaces (an uncounted space adds nothing). */
  peopleNow: number;
  /** The limits of the open and full spaces. */
  placesMax: number;
}

export function spaceTotals(spaces: readonly Pick<SpaceState, "status" | "capacityMax" | "capacityNow">[]): SpaceTotals {
  const byStatus: Record<SpaceStatus, number> = { open: 0, full: 0, closed: 0, not_activated: 0 };
  let peopleNow = 0;
  let placesMax = 0;
  for (const space of spaces) {
    byStatus[space.status] += 1;
    if (isResidentStatus(space.status)) {
      peopleNow += space.capacityNow ?? 0;
      placesMax += space.capacityMax;
    }
  }
  return { byStatus, peopleNow, placesMax };
}
