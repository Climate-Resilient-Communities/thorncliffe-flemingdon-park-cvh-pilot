import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { can } from "@/modules/identity";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../guard";
import { loadQueue } from "./load";
import { QueueBody } from "./QueueBody";
import { MODERATION_PAGE } from "./view";

export const metadata: Metadata = { title: englishText("staff.moderation.title") };

/**
 * "Moderation" (O-08, PRD §6.3 "Community contributions and moderation queue", D9/E4): the places residents suggested and the corrections they
 * sent, oldest first, and what was decided lately. The policy action `moderation.view`: a Coordinator, a Director read-only (told so) and an
 * Admin; an Ambassador sees that only those roles can open it. Each card opens the suggestion's review (O-09), where `moderation.review`
 * decides. Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: MODERATION_PAGE,
    access: "hub",
    action: "moderation.view",
    refused: () => (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <h1>{englishText("staff.moderation.title")}</h1>
          <p role="alert" className="hub-error">
            {englishText("staff.moderation.forbidden")}
          </p>
        </Stack>
      </Screen>
    ),
  },
  async (session) => (
    <Screen surface="staff">
      <QueueBody screen={await loadQueue()} readOnly={!can(session.role, "moderation.review")} />
    </Screen>
  ),
);
