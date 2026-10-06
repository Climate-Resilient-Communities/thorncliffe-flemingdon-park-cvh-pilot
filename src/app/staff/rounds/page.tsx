import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { AutoRefresh } from "../alerts/sending/AutoRefresh";
import { staffPage } from "../guard";
import { loadRounds } from "./load";
import { RoundsBody } from "./RoundsBody";
import { ROUNDS_PAGE, ROUNDS_REFRESH_SECONDS } from "./view";

export const metadata: Metadata = { title: englishText("staff.rounds.title") };

/**
 * "Check-in rounds" (O-17, S08.08): the escalations of the ambassadors' rounds, open first, each with its building, floor, status, time and ambassador; an
 * escalation appears as soon as its mark commits (it is made in the mark's transaction), and the page renders again every 15 seconds while it is open. The
 * policy action is `checkins.escalations` (a Coordinator, a Director read-only, an Admin; an Ambassador hears from their own round page). No resident's
 * number is read for this page. Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: ROUNDS_PAGE,
    access: "hub",
    action: "checkins.escalations",
    refused: () => (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <h1>{englishText("staff.rounds.title")}</h1>
          <p role="alert" className="hub-error">
            {englishText("staff.rounds.forbidden")}
          </p>
        </Stack>
      </Screen>
    ),
  },
  async () => (
    <Screen surface="staff">
      <AutoRefresh seconds={ROUNDS_REFRESH_SECONDS} />
      <RoundsBody screen={await loadRounds()} />
    </Screen>
  ),
);
