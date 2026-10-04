import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { stdoutMessagingLog } from "@/modules/messaging";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../guard";
import { DrillsView } from "./DrillsView";
import { loadDrills } from "./load";
import { DRILLS_PAGE } from "./view";

export const metadata: Metadata = { title: englishText("staff.drills.title") };

const t = (key: string) => englishText(`staff.drills.${key}`);

function Heading() {
  return (
    <Stack gap="related">
      <h1>{t("title")}</h1>
      <p>{t("lead")}</p>
    </Stack>
  );
}

/**
 * "Drills" (S06.05): start a drill, open the drill roster, and see what became of each recent drill's texts per roster member and language. The policy action
 * `drill.run`, Admins only (S01.12); starting a drill and changing the roster run at aal2 (S01.10). Another role sees "Only an Admin can run drills." and nothing
 * else. Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: DRILLS_PAGE,
    access: "hub",
    action: "drill.run",
    refused: () => (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <Heading />
          <p role="alert" className="hub-error">
            {t("errors.forbidden")}
          </p>
        </Stack>
      </Screen>
    ),
  },
  async () => {
    try {
      return (
        <Screen surface="staff">
          <DrillsView view={await loadDrills()} />
        </Screen>
      );
    } catch (error) {
      stdoutMessagingLog.error("drills.read_failed", { module: "messaging", error: error instanceof Error ? error.name : "NonError" });
      return (
        <Screen surface="staff">
          <Stack gap="section-hub">
            <Heading />
            <p role="alert" className="hub-error" data-testid="drills-unreadable">
              {t("errors.unreadable")}
            </p>
          </Stack>
        </Screen>
      );
    }
  },
);
