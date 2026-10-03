// What waits for this person and what they have in hand, read from the database and drawn (S04.07's share of the Hub home), with the alerts that are running
// for the roles that write to them (S05.01). Server only.
import type { StaffRole } from "@/contracts/staffRoles";
import { alerting } from "../../alerts";
import { IncidentsList } from "./IncidentsList";
import { incidentsView } from "./view";

export async function IncidentsPanel({ staffId, role }: { staffId: string; role: StaffRole }) {
  const author = role === "coordinator" || role === "admin";
  const [incidents, running] = await Promise.all([alerting().incidents({ staffId }), author ? alerting().runningThreads() : Promise.resolve([])]);
  return <IncidentsList view={incidentsView(incidents, role, undefined, running)} />;
}
