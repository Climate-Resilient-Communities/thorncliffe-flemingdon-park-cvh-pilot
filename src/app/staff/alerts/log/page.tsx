import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen } from "@/ui";
import { staffPage } from "../../guard";
import { buildings } from "../../places";
import { logDisruptionAction } from "./actions";
import { LogBody } from "./LogBody";
import { forbiddenMessage, logScreen } from "./view";

export const metadata: Metadata = { title: englishText("staff.log.title") };

/**
 * "Log a disruption" (O-11, S04.05): the types, the place and the time of the first report, then the acknowledgement composer (O-12)
 * opens on the thread this creates. The policy action `alert.author_wide`, which a Coordinator and an Admin have (S01.12); another role
 * sees "Only a Coordinator or an Admin can log a disruption." and the action refuses it on its own. Responses are no-store. The shell
 * (layout.tsx) owns the <main>; the screen is the prototype's `log` width.
 */
export default staffPage(
  {
    route: "/staff/alerts/log",
    access: "hub",
    action: "alert.author_wide",
    refused: () => (
      <Screen surface="staff" width="log">
        <p role="alert" className="hub-error">
          {forbiddenMessage()}
        </p>
      </Screen>
    ),
  },
  async () => {
    const screen = logScreen(await buildings().listFloorPlans(), new Date(), { kind: "ack" });
    return (
      <Screen surface="staff" width="log">
        <LogBody screen={screen} action={logDisruptionAction} />
      </Screen>
    );
  },
);
