// Composition root of the Ambassador's home for the staff surface (AD-2, S08.01): the person's current assignments (identity), the buildings' addresses, floors and
// neighbourhoods (places), the alerts about their buildings and their own posts (alerting) and their open round (check-ins). Read on every request: nothing here
// is cached, so a removed assignment takes its building off the home with the next one. Server only.
import { createAmbassadorHome, type AmbassadorHome } from "@/modules/alerting";
import { NO_OPEN_ROUNDS, type RoundSummaryReader } from "@/modules/checkins";
import { getDb } from "@/platform/db";
import { assignments } from "../assignments";
import { buildings } from "../places";
import type { StaffSession } from "../session";
import type { AmbassadorHomeData, AssignedBuilding } from "./view";

let alertsAndPosts: AmbassadorHome | undefined;

/** The open round for the person's floors. No round exists until E08's round stories; they replace this with the check-ins module's reader. */
export const rounds: RoundSummaryReader = NO_OPEN_ROUNDS;

/** What the home shows for a person, from their assignments as they are now. */
export async function loadAmbassadorHome(session: Pick<StaffSession, "staffId">, reader: RoundSummaryReader = rounds): Promise<AmbassadorHomeData> {
  const current = await assignments().assignmentsOf(session.staffId);
  const plans = await buildings().listFloorPlans();
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
  const scope = {
    staffId: session.staffId,
    assignedRsns: assigned.map((building) => building.rsn),
    neighbourhoodOf: new Map(plans.map((plan) => [plan.rsn, plan.neighbourhoodId])),
  };
  const [home, round] = await Promise.all([(alertsAndPosts ??= createAmbassadorHome(getDb())).read(scope), reader.openFor(current)]);
  return { buildings: assigned, alerts: home.alerts, posts: home.posts, round };
}

/** Test seam: forget the composition. */
export function resetAmbassadorHomeComposition(): void {
  alertsAndPosts = undefined;
}
