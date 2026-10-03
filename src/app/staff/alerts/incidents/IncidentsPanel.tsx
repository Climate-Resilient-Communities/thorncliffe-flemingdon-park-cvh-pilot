// The Hub home, read from the database and drawn (O-01): what waits for this person and how long it has waited (S04.07), the open threads for the roles that
// read or write them (S05.01; a Director only reads), the person's own alerts, and the drills apart (S04.10). Server only.
import type { StaffRole } from "@/contracts/staffRoles";
import { alerting } from "../../alerts";
import { IncidentsList } from "./IncidentsList";
import { incidentsView } from "./view";

export async function IncidentsPanel({ staffId, role }: { staffId: string; role: StaffRole }) {
  // The open threads are for the roles that write to them (Coordinator, Admin) and, to read, the Director; an Ambassador's home is their own alerts.
  const threads = role === "coordinator" || role === "admin" || role === "director";
  const [incidents, running] = await Promise.all([alerting().incidents({ staffId }), threads ? alerting().runningThreads() : Promise.resolve([])]);
  return <IncidentsList view={incidentsView(incidents, role, undefined, running)} />;
}
