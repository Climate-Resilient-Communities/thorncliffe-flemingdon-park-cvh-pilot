import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen } from "@/ui";
import { LogBody } from "../../alerts/log/LogBody";
import { logScreen } from "../../alerts/log/view";
import { staffPage } from "../../guard";
import { buildings } from "../../places";
import { DRILL_START_PAGE } from "../view";
import { startDrillAction } from "./actions";

export const metadata: Metadata = { title: englishText("staff.log.drillTitle") };

/**
 * "Start a drill" (S06.05): the types, the place and the time of the first report, as "Log a disruption" asks them, then the drill's acknowledgement composer opens
 * on the thread this creates, with `is_drill` true and the exercise marker on every screen. The policy action `drill.run`, Admins only (S01.12), at aal2 (S01.10);
 * another role sees "Only an Admin can start a drill." and the action refuses it on its own. Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: DRILL_START_PAGE,
    access: "hub",
    action: "drill.run",
    refused: () => (
      <Screen surface="staff" width="log">
        <p role="alert" className="hub-error">
          {englishText("staff.log.drillForbidden")}
        </p>
      </Screen>
    ),
  },
  async () => {
    const screen = logScreen(await buildings().listFloorPlans(), new Date(), { kind: "ack", drill: true });
    return (
      <Screen surface="staff" width="log">
        <LogBody screen={screen} action={startDrillAction} />
      </Screen>
    );
  },
);
