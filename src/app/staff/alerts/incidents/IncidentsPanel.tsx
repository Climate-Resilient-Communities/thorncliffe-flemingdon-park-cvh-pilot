// What waits for this person and what they have in hand, read from the database and drawn (S04.07's share of the Hub home). Server only.
import type { StaffRole } from "@/contracts/staffRoles";
import { alerting } from "../../alerts";
import { IncidentsList } from "./IncidentsList";
import { incidentsView } from "./view";

export async function IncidentsPanel({ staffId, role }: { staffId: string; role: StaffRole }) {
  return <IncidentsList view={incidentsView(await alerting().incidents({ staffId }), role)} />;
}
