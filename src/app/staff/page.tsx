import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen } from "@/ui";
import { IncidentsPanel } from "./alerts/incidents/IncidentsPanel";
import { AmbassadorHomeBody } from "./ambassador/AmbassadorHomeBody";
import { loadAmbassadorHome } from "./ambassador/home";
import { ambassadorHomeView } from "./ambassador/view";
import { staffPage } from "./guard";

export const metadata: Metadata = { title: englishText("staff.hub.title") };

/**
 * The Hub's home (O-01, S04.07, S04.10): what waits for this person's approval and for how long, the open threads, the person's own alerts and the
 * drills in a section of their own. A Director sees the same, read-only. An Ambassador's home, at this same address, is their own (A-01, S08.01): the open
 * alerts about the buildings they are assigned to now, as residents read them, their own posts with each one's state, and their round while one is open,
 * all read from their current assignments on each request. The person, the sign-out button and the navigation are the shell's (layout.tsx), which also
 * owns the <main>.
 */
export default staffPage({ route: "/staff", access: "hub", action: "hub.open" }, async (session) => (
  <Screen surface="staff">
    {session.role === "ambassador" ? <AmbassadorHomeBody view={ambassadorHomeView(await loadAmbassadorHome(session))} /> : <IncidentsPanel staffId={session.staffId} role={session.role} />}
  </Screen>
));
