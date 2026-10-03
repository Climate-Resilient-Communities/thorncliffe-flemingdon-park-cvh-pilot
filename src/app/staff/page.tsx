import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { IncidentsPanel } from "./alerts/incidents/IncidentsPanel";
import { staffPage } from "./guard";

export const metadata: Metadata = { title: englishText("staff.hub.title") };

/**
 * The Hub's home, at the last gate of the setup sequence: a placeholder until the incidents screen (S04.10) replaces it, with the list S04.07 needs
 * on it: what waits for this person's approval and the alerts they have in hand, with the note an approver sent back with. The person, the sign-out
 * button and the navigation are the shell's (layout.tsx), which also owns the <main>.
 */
export default staffPage({ route: "/staff", access: "hub", action: "hub.open" }, (session) => (
  <Screen surface="staff">
    <Stack gap="stack">
      <Stack gap="related">
        <h1>{englishText("staff.hub.title")}</h1>
        <p>{englishText("staff.hub.lead")}</p>
      </Stack>
      <IncidentsPanel staffId={session.staffId} role={session.role} />
    </Stack>
  </Screen>
));
