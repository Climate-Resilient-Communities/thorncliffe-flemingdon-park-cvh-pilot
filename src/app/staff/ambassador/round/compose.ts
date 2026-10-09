// "My round" (S08.07, A-04) composed for one person (AD-12: "the round screen composes contacts in the app layer from subscriptions"): the live rows of the
// open rounds, kept or counted by the role policy on the person's current assignments, with the numbers of the requests they may see. Pure but for the one
// read it is handed (the numbers, asked only for the rows shown with them), so the tests drive it without a database.
//
// Who sees what (the AD-4 rows "See open check-in rows" and "See counts and coverage"):
//  - a request on a floor the person may see (`checkins.view_open`: an Ambassador who covers the floor now, or an Admin) is its `round_ref`, the number,
//    the method and its latest mark, under its building and floor; never a name, a reason or a row id (the subscriber's id stays on the server);
//  - any other floor of a building an Ambassador is assigned to, and every floor for a Coordinator or a Director (`coverage.view`), is counts only;
//  - an Ambassador sees nothing of a building they are not assigned to.
// A floor is covered as identity's `coversFloor` says: only while it is one of its building's floors (places'). A request on a floor an Admin removed
// since it was made counts as one on an uncovered floor (S08.05): counts for an Ambassador of the building, its number for an Admin only.
// A row whose thread is not an open thread residents read (a closed one, before S08.08's close tallies its rows) is not shown; the app hands it only the
// rows whose requester still asks and receives texts (load.ts), and a request whose number is not read back (withdrawn or lapsed since) is left out.
import type { RoundCounts, RoundFloor, RoundResponse, RowStatus } from "@/contracts/checkinRound";
import type { StaffRole } from "@/contracts/staffRoles";
import type { LiveRoundRow } from "@/modules/checkins";
import { can, type PolicyAssignment } from "@/modules/identity";
import { staffLanguageName } from "../../languageName";

/** The person the round is composed for: their role, and their assignments now (none for anyone but an active Ambassador). */
export interface RoundViewer {
  role: StaffRole;
  assignments: readonly PolicyAssignment[];
}

/** A building as the page names it, with its floors in the building's own order. */
export interface RoundPlan {
  rsn: string;
  address: string;
  floors: readonly { id: string; label: string }[];
}

export interface RoundSources {
  rows: readonly LiveRoundRow[];
  /** The open threads residents read, with the words that cover each (alerting's `openHeadlines`). */
  headlines: ReadonlyMap<string, string>;
  plans: readonly RoundPlan[];
  /** The numbers of these subscribers that still ask and receive texts, with the language each chose (subscriptions' `checkinContactsOf`). */
  contactsOf: (subscriberIds: readonly string[]) => Promise<ReadonlyMap<string, { phone: string; lang: string }>>;
}

/** How a person sees a row: with its number, as a count, or not at all. */
export type RowSight = "contact" | "count" | "none";

/** The row's floor while it is one of its building's floors, else null (removed since: an uncovered floor). */
export function listedFloor(plans: ReadonlyMap<string, RoundPlan>, row: { rsn: string; floorId: string }): string | null {
  return plans.get(row.rsn)?.floors.some((floor) => floor.id === row.floorId) ? row.floorId : null;
}

/** How this person sees a row on this floor (null: not a floor of the building any more, which nobody covers). */
export function sightOf(viewer: RoundViewer, row: { rsn: string; floorId: string | null }): RowSight {
  if (can(viewer.role, "checkins.view_open", { assignments: viewer.assignments, target: { rsn: row.rsn, floorId: row.floorId }, alertOpen: true })) return "contact";
  if (can(viewer.role, "coverage.view") || viewer.assignments.some((assignment) => assignment.rsn === row.rsn)) return "count";
  return "none";
}

const emptyCounts = (): RoundCounts => ({ pending: 0, done: 0, not_reached: 0, needs_help: 0 });

/** The round as the person may see it: every open round (thread) with a row they see, oldest first, by building and floor in their own order. */
export async function composeRound(viewer: RoundViewer, sources: RoundSources): Promise<RoundResponse> {
  const plans = new Map(sources.plans.map((plan) => [plan.rsn, plan]));
  const seen = sources.rows
    .filter((row) => sources.headlines.has(row.alertId))
    .map((row) => ({ row, sight: sightOf(viewer, { rsn: row.rsn, floorId: listedFloor(plans, row) }) }))
    .filter((item) => item.sight !== "none");
  const contactIds = [...new Set(seen.filter((item) => item.sight === "contact").map((item) => item.row.subscriberId))];
  const contacts = contactIds.length === 0 ? new Map<string, { phone: string; lang: string }>() : await sources.contactsOf(contactIds);
  const buildingOrder = new Map(sources.plans.map((plan, index) => [plan.rsn, index]));
  // A floor removed from its building since (no label any more) comes after the building's own floors.
  const floorOrder = (rsn: string, floorId: string) => {
    const index = plans.get(rsn)?.floors.findIndex((floor) => floor.id === floorId) ?? -1;
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  // Thread, then building, then floor; each floor is the person's requests on it, or its counts.
  const threads = new Map<string, Map<string, Map<string, { contacts: RoundFloor & { kind: "contacts" }; counts: RoundCounts; sight: RowSight }>>>();
  for (const { row, sight } of seen) {
    const contact = sight === "contact" ? contacts.get(row.subscriberId) : undefined;
    if (sight === "contact" && contact === undefined) continue;
    const buildings = threads.get(row.alertId) ?? new Map();
    threads.set(row.alertId, buildings);
    const floors = buildings.get(row.rsn) ?? new Map();
    buildings.set(row.rsn, floors);
    const label = plans.get(row.rsn)?.floors.find((floor) => floor.id === row.floorId)?.label ?? "";
    const floor = floors.get(row.floorId) ?? { contacts: { kind: "contacts" as const, label, requests: [] }, counts: emptyCounts(), sight };
    floors.set(row.floorId, floor);
    // UAT note 9: the resident's language beside their number, so they are called or texted in it.
    if (contact !== undefined) floor.contacts.requests.push({ round_ref: row.roundRef, phone: contact.phone, method: row.method, status: row.status, language: staffLanguageName(contact.lang) });
    else floor.counts[row.status as RowStatus] += 1;
  }

  return {
    rounds: [...threads.entries()].map(([alertId, buildings]) => ({
      headline: sources.headlines.get(alertId) ?? "",
      buildings: [...buildings.entries()]
        .sort(([a], [b]) => (buildingOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (buildingOrder.get(b) ?? Number.MAX_SAFE_INTEGER))
        .map(([rsn, floors]) => ({
          address: plans.get(rsn)?.address ?? rsn,
          floors: [...floors.entries()]
            .sort(([a], [b]) => floorOrder(rsn, a) - floorOrder(rsn, b))
            .map(([, floor]): RoundFloor => (floor.sight === "contact" ? floor.contacts : { kind: "counts", label: floor.contacts.label, counts: floor.counts })),
        })),
    })),
  };
}
