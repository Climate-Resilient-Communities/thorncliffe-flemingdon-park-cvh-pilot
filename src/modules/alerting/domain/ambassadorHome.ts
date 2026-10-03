// What an Ambassador's home shows (S08.01, UX-DR17 A-01): which open alerts are about their buildings, and how to tell each of their own posts' state.
// Pure: no I/O and no clock. The reads are `application/ambassadorHome.ts`; the scope is always the person's CURRENT assignments, passed in, so a removed
// assignment takes its building out of the home at once and a person with none sees nothing (fail closed).
import type { Audience } from "../../../contracts/audience";
import type { FeedThread } from "../../../contracts/feed";

/** The state of one of an Ambassador's own posts, as A-01 and A-03 word it. */
export const AMBASSADOR_POST_STATES = ["live", "waiting", "approved", "verified", "returned", "declined", "withdrawn", "corrected"] as const;
export type AmbassadorPostState = (typeof AMBASSADOR_POST_STATES)[number];

/**
 * Whether an alert's audience is about one of the buildings the person is assigned to. A buildings audience names an assigned building (whatever floors it
 * lists: the home is the building's, not the floor's); a neighbourhood audience is about every building in it, so the neighbourhood of an assigned building.
 * No assignment, or an unknown neighbourhood, is no match.
 */
export function audienceCoversAssigned(audience: Audience, assignedRsns: ReadonlySet<string>, neighbourhoodOf: ReadonlyMap<string, string>): boolean {
  if (audience.scope === "buildings") return audience.buildings.some((building) => assignedRsns.has(building.rsn));
  const wanted = new Set(audience.neighbourhood_ids);
  for (const rsn of assignedRsns) {
    const neighbourhood = neighbourhoodOf.get(rsn);
    if (neighbourhood !== undefined && wanted.has(neighbourhood)) return true;
  }
  return false;
}

/**
 * Whether an own post still belongs on the home: it is for buildings (an Ambassador only posts for a building) and every one of them is still assigned.
 * An assignment removed since the post takes the post off the home, like the building itself; a neighbourhood audience is never an Ambassador's.
 */
export function postIsInScope(audience: Audience, assignedRsns: ReadonlySet<string>): boolean {
  return audience.scope === "buildings" && audience.buildings.every((building) => assignedRsns.has(building.rsn));
}

/**
 * The entry of an open thread that says what is going on now, from the feed's entries (oldest first): the latest substantive one that nothing replaced
 * (a withdrawal notice never covers), else the latest entry.
 */
export function coveringFeedEntry(entries: FeedThread["entries"]): FeedThread["entries"][number] {
  const replaced = new Set(entries.flatMap((entry) => (entry.supersedes_id ? [entry.supersedes_id] : [])));
  const live = entries.filter((entry) => entry.kind !== "withdrawal" && !replaced.has(entry.id));
  return (live.length > 0 ? live : entries).at(-1)!;
}

/** What `postState` reads of an entry the person wrote, and of what replaced it. */
export interface PostFacts {
  status: string;
  submittedAt: Date | null;
  approvedAt: Date | null;
  webPublishedAt: Date | null;
  returnedFor: string | null;
  /** The kind of an approved correction or withdrawal that replaces this entry, when there is one. */
  replacedBy: "correction" | "withdrawal" | null;
}

/**
 * Where one of the person's own posts stands, or null when it is not a post (a draft nobody submitted, or one the author discarded before submitting):
 *  - waiting: submitted, not yet read by residents, waiting for the Hub;
 *  - live: web-published at submit and still "Not yet verified" (a D-1 post, E08);
 *  - approved: approved, and published at its approval;
 *  - verified: approved after it was already live, so the Hub has now verified it;
 *  - returned: sent back to the author with a note; declined: not sent by the Hub;
 *  - corrected, withdrawn: replaced by an approved correction or withdrawal.
 */
export function postState(facts: PostFacts): AmbassadorPostState | null {
  if (facts.status === "draft") return facts.returnedFor === "return" ? "returned" : null;
  if (facts.status === "discarded") return facts.submittedAt !== null ? "declined" : null;
  if (facts.status === "pending_approval") return facts.webPublishedAt !== null ? "live" : "waiting";
  if (facts.status === "approved" || facts.status === "superseded") {
    if (facts.replacedBy === "correction") return "corrected";
    if (facts.replacedBy === "withdrawal") return "withdrawn";
    return facts.approvedAt !== null && facts.webPublishedAt !== null && facts.webPublishedAt.getTime() < facts.approvedAt.getTime() ? "verified" : "approved";
  }
  return null;
}
