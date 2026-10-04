// What an ambassador's post adds to the entry rules (S08.02, AD-5): why an entry was discarded, and who an entry is attributed to. Pure: no I/O, no clock.
//
// Why: an ambassador's post reads "Not sent by the Hub" only when the Hub really declined it (the decision S08.01 handed over), never when its author took
// it back or its alert closed first. Every use case that discards says which (`alert_entry.discard_reason`, db/migrations/20261004230000_ambassador_post.sql).
//
// Who: residents and the approver read who an entry is from as it was frozen at submit with its texts (`alert_entry.attributed_rsn`), never from the author's
// role at the time they read: "Building ambassador, {building}" for an ambassador's post, the Hub for everything else (spine, AD-5 "Seam for E08").
import type { StaffRole } from "../../../contracts/staffRoles";
import type { Audience } from "../../../contracts/audience";

/**
 * Why an entry was discarded:
 *  - `by_author`: its author took back their own draft or submitted entry;
 *  - `declined`: anyone else discarded it: the Hub did not send it (an approver's Discard, O-05 and O-07);
 *  - `by_close`: its thread closed with it unread (a final's or a withdrawal's approval, or the expire job: `closeAlert`).
 */
export const DISCARD_REASONS = ["by_author", "declined", "by_close"] as const;
export type DiscardReason = (typeof DISCARD_REASONS)[number];

export function isDiscardReason(value: unknown): value is DiscardReason {
  return typeof value === "string" && (DISCARD_REASONS as readonly string[]).includes(value);
}

/** The reason of a person's discard (`discardEntry`): the author's own is `by_author`; anyone else's, an editor who is not the author included, is the Hub declining it. */
export function discardReasonOf(actorId: string, authorId: string): Exclude<DiscardReason, "by_close"> {
  return actorId === authorId ? "by_author" : "declined";
}

/** Who an entry is from, as frozen at submit: the Hub, or a building ambassador of one building (by rsn), never a person. */
export type EntryAttribution = { role: "hub" } | { role: "ambassador"; rsn: string };

export const HUB: EntryAttribution = { role: "hub" };

/**
 * The attribution an entry gets when someone of this role submits it: an Ambassador's post is attributed to its building, and so must be for exactly one
 * building (A-02 posts for one building; an audience of several, or a neighbourhood, is refused: `ONE_BUILDING_ONLY`); everyone else's is the Hub's.
 */
export function attributionFor(role: StaffRole, audience: Audience): EntryAttribution | "ONE_BUILDING_ONLY" {
  if (role !== "ambassador") return HUB;
  if (audience.scope !== "buildings" || audience.buildings.length !== 1) return "ONE_BUILDING_ONLY";
  return { role: "ambassador", rsn: audience.buildings[0].rsn };
}

/** The attribution stored with a frozen entry (`attributed_rsn`): an ambassador's building, or the Hub's when there is none. */
export const attributionOfRsn = (rsn: string | null | undefined): EntryAttribution => (rsn ? { role: "ambassador", rsn } : HUB);

/** The column that holds the attribution: the building of an ambassador's post, null for the Hub's. */
export const rsnOfAttribution = (attribution: EntryAttribution): string | null => (attribution.role === "ambassador" ? attribution.rsn : null);

export function sameAttribution(a: EntryAttribution, b: EntryAttribution): boolean {
  return rsnOfAttribution(a) === rsnOfAttribution(b);
}
