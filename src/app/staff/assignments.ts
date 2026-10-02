// Composition root of the Ambassador assignments for the staff surface (AD-2): identity owns the
// assignments and `coversFloor`; it may not import places, so the building's floors reach it here,
// through places' reader, on the app's database connection. Server only.
import { createAssignments, type AssignmentService } from "@/modules/identity";
import { floorsOfBuilding } from "@/modules/places";
import { getDb } from "@/platform/db";

let service: AssignmentService | undefined;

/** The assignment use cases and `coversFloor` (S01.14). */
export function assignments(): AssignmentService {
  return (service ??= createAssignments({ db: getDb(), floors: { floorsOf: floorsOfBuilding } }));
}

/** Test seam: forget the composition. */
export function resetAssignmentsComposition(): void {
  service = undefined;
}
