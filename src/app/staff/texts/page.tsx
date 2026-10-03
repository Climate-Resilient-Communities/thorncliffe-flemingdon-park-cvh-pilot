import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { PAUSE_REASON_MAX_CHARS } from "@/modules/messaging";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../guard";
import { logPauseError, messagingPause, pausedByName } from "../messagingPause";
import { PauseTextsForm } from "./PauseTextsForm";
import { TextsView } from "./TextsView";
import { pausedView, type PausedView } from "./view";

export const metadata: Metadata = { title: englishText("staff.texts.title") };

// "Resume texts" runs in the server action of this page and, once the resume has committed, starts a dispatcher run that lives in this
// function after the response (kickDispatcher, src/app/dispatch.ts): the segment needs the same 60 seconds as the job route's run, a
// literal Next.js reads statically.
export const maxDuration = 60;

const t = (key: string) => englishText(`staff.texts.${key}`);

function Heading() {
  return (
    <Stack gap="related">
      <h1>{t("title")}</h1>
      <p>{t("lead")}</p>
    </Stack>
  );
}

/** What the page says: whether texts are paused (and by whom), or that the switch could not be read. */
async function readPause(): Promise<{ paused: PausedView | null; unreadable: boolean }> {
  try {
    const status = await messagingPause().status();
    if (!status.paused) return { paused: null, unreadable: false };
    const name = await pausedByName(status.pausedBy).catch(() => null);
    return { paused: pausedView(status, name), unreadable: false };
  } catch (error) {
    logPauseError("messaging.pause_status_failed", { error: error instanceof Error ? error.name : "NonError" });
    return { paused: null, unreadable: true };
  }
}

/**
 * "Pause or resume texts" (S06.06): the one switch that stops every text not yet handed to the provider, with the reason, who, when,
 * and what had already gone out; and "Resume texts". The policy action `sending.pause`, Admins only (S01.12); its actions run at aal2
 * (S01.10). Another role sees "Only an Admin can pause or resume texts." and nothing else. Responses are no-store. The shell (layout.tsx)
 * owns the <main>.
 */
export default staffPage(
  {
    route: "/staff/texts",
    access: "hub",
    action: "sending.pause",
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
    const { paused, unreadable } = await readPause();
    return (
      <Screen surface="staff">
        <TextsView
          paused={paused}
          unreadable={unreadable}
          form={
            <PauseTextsForm
              paused={paused !== null}
              reasonMaxLength={PAUSE_REASON_MAX_CHARS}
              labels={{
                reason: t("reason"),
                reasonHint: t("reasonHint"),
                pause: t("pause"),
                pausing: t("pausing"),
                resume: t("resume"),
                resuming: t("resuming"),
                resumeHint: t("resumeHint"),
              }}
            />
          }
        />
      </Screen>
    );
  },
);
