import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen } from "@/ui";
import { IncidentsPanel } from "./alerts/incidents/IncidentsPanel";
import { staffPage } from "./guard";

export const metadata: Metadata = { title: englishText("staff.hub.title") };

/**
 * The Hub's home (O-01, S04.07, S04.10): what waits for this person's approval and for how long, the open threads, the person's own alerts and the
 * drills in a section of their own. A Director sees the same, read-only. The person, the sign-out button and the navigation are the shell's (layout.tsx),
 * which also owns the <main>.
 */
export default staffPage({ route: "/staff", access: "hub", action: "hub.open" }, (session) => (
  <Screen surface="staff">
    <IncidentsPanel staffId={session.staffId} role={session.role} />
  </Screen>
));
