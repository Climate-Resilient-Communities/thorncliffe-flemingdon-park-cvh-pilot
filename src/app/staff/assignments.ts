// Composition root of the Ambassador assignments for the staff surface (AD-2): identity owns the
// assignments and `coversFloor`; it may not import places, so the building's floors reach it here,
// through places' reader, on the app's database connection. A saved assignment adds the building's
// check-in requesters on floors it now covers to its open rounds (checkins' `joinBuildingRounds`, with
// subscriptions' requesters in the building), in the assignment's transaction. Server only.
import { createAssignments, type AssignmentService } from "@/modules/identity";
import { floorsOfBuilding } from "@/modules/places";
import { checkinRequestersIn } from "@/modules/subscriptions";
import { getDb } from "@/platform/db";
import { checkinRequests } from "../checkins";

let service: AssignmentService | undefined;

/** The assignment use cases and `coversFloor` (S01.14). */
export function assignments(): AssignmentService {
  return (service ??= createAssignments({
    db: getDb(),
    floors: { floorsOf: floorsOfBuilding },
    rounds: {
      assignmentSaved: async (tx, rsn) => {
        await checkinRequests().joinBuildingRounds(tx, rsn, await checkinRequestersIn(tx, [rsn]));
      },
    },
  }));
}

/** Test seam: forget the composition. */
export function resetAssignmentsComposition(): void {
  service = undefined;
}
