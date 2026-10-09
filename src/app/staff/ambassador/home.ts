// Composition root of the Ambassador's home for the staff surface (AD-2, S08.01): the person's current assignments (identity), the buildings' addresses, floors and
// neighbourhoods (places), the alerts about their buildings and their own posts (alerting) and their open round (check-ins, S08.07). Read on every request: nothing here
// is cached, so a removed assignment takes its building off the home with the next one. Server only.
import { createAmbassadorHome, type AmbassadorHome, type AmbassadorPostStatus, type AmbassadorScope } from "@/modules/alerting";
import type { RoundSummaryReader } from "@/modules/checkins";
import type { PolicyAssignment } from "@/modules/identity";
import { getDb } from "@/platform/db";
import { assignments } from "../assignments";
import { buildings } from "../places";
import type { StaffSession } from "../session";
import { roundReads } from "./round/load";
import type { AmbassadorHomeData, AssignedBuilding } from "./view";

let alertsAndPosts: AmbassadorHome | undefined;

/**
 * The open round for the person's floors (S08.07): the requests of the open rounds on the floors their current assignments cover, from the round page's own
 * reads (./round/load.ts; test/db/roundPage.db.test.ts counts them with an open round). Made on first use, on the app's database.
 */
export const rounds: RoundSummaryReader = { openFor: (assignments) => roundReads().summary.openFor(assignments) };

const reader = (): AmbassadorHome => (alertsAndPosts ??= createAmbassadorHome(getDb()));

/** The buildings the person is assigned to now, with their floors written out, and the scope their reads are made in (S08.01): from their current assignments, on each call. */
export async function loadAssigned(
  session: Pick<StaffSession, "staffId">,
): Promise<{ assigned: AssignedBuilding[]; scope: AmbassadorScope; current: readonly PolicyAssignment[]; floorLabels: ReadonlyMap<string, string> }> {
  const current = await assignments().assignmentsOf(session.staffId);
  // With the merged buildings (UAT F-5): an assignment made before a merge still names its building, which is shown by its address.
  const plans = await buildings().listFloorPlans({ includeMerged: true });
  const assigned: AssignedBuilding[] = [];
  for (const assignment of current) {
    const plan = plans.find((candidate) => candidate.rsn === assignment.rsn);
    // An assignment to a building that is no longer in the list (never in practice: the database ties them) is not shown, and gives no scope.
    if (!plan) continue;
    assigned.push({
      rsn: plan.rsn,
      address: plan.address,
      floorLabels: assignment.floorIds === null ? null : plan.floors.filter((floor) => assignment.floorIds?.includes(floor.id)).map((floor) => floor.label),
    });
  }
  const scope: AmbassadorScope = {
    staffId: session.staffId,
    assignedRsns: assigned.map((building) => building.rsn),
    neighbourhoodOf: new Map(plans.map((plan) => [plan.rsn, plan.neighbourhoodId])),
  };
  return { assigned, scope, current, floorLabels: new Map(plans.flatMap((plan) => plan.floors.map((floor) => [floor.id, floor.label] as const))) };
}

/** What the home shows for a person, from their assignments as they are now. */
export async function loadAmbassadorHome(session: Pick<StaffSession, "staffId">, roundReader: RoundSummaryReader = rounds): Promise<AmbassadorHomeData> {
  const { assigned, scope, current } = await loadAssigned(session);
  const [home, round] = await Promise.all([reader().read(scope), roundReader.openFor(current)]);
  return { buildings: assigned, alerts: home.alerts, posts: home.posts, drills: home.drills, round };
}

/** One of the person's own posts and where it stands (A-03, S08.04), read from their assignments as they are now; null for anything that is not theirs to see. */
export async function loadPostStatus(
  session: Pick<StaffSession, "staffId">,
  entryId: string,
): Promise<{ status: AmbassadorPostStatus; addresses: ReadonlyMap<string, string>; floorLabels: ReadonlyMap<string, string> } | null> {
  const { assigned, scope, floorLabels } = await loadAssigned(session);
  const status = await reader().status(scope, entryId);
  return status === null ? null : { status, addresses: new Map(assigned.map((building) => [building.rsn, building.address])), floorLabels };
}

/**
 * The alert "Mark resolved" is for (S08.04): what covers it, whether a final message already waits, and nothing otherwise (null) for a thread the person may not
 * resolve: closed, nothing residents read, or not about exactly one building they are assigned to.
 */
export async function loadResolvable(session: Pick<StaffSession, "staffId">, alertId: string): Promise<{ headline: string; waitingFinal: boolean } | null> {
  const { scope } = await loadAssigned(session);
  return reader().resolvable(scope, alertId);
}

/** Test seam: forget the composition. */
export function resetAmbassadorHomeComposition(): void {
  alertsAndPosts = undefined;
}
