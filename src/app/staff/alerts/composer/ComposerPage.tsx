// The one render of both composers' pages (S04.05): the acknowledgement composer (O-12, /staff/alerts/ack) and the alert composer (O-02,
// /staff/alerts/compose). Server only; the pages themselves are staffPage()s (the guard).
import { englishText } from "@/i18n/text";
import { Screen } from "@/ui";
import { logDisruptionAction } from "../log/actions";
import { LogBody } from "../log/LogBody";
import { logScreen } from "../log/view";
import { buildings } from "../../places";
import { pullBackAction, saveDraftAction } from "./actions";
import { ComposerBody } from "./ComposerBody";
import { loadComposer, type ComposerQuery } from "./loadComposer";
import type { ComposerMode } from "./view";

const actions = { save: saveDraftAction, pullBack: pullBackAction };

/** What every composer page shows to a role its policy refuses: the guard has already refused the calls it would make. */
export const forbiddenView = () => (
  <Screen surface="staff" width="review">
    <p role="alert" className="hub-error">
      {englishText("staff.compose.errors.forbidden")}
    </p>
  </Screen>
);

export async function ComposerPage({ mode, query }: { mode: ComposerMode; query: ComposerQuery }) {
  // The alert composer with no draft named starts where "Log a disruption" does: the types, the place and the time of the first report.
  if (mode === "alert" && query.alert === undefined && query.entry === undefined) {
    const screen = logScreen(await buildings().listFloorPlans(), new Date(), { kind: "update" });
    return (
      <Screen surface="staff" width="log">
        <LogBody screen={screen} action={logDisruptionAction} />
      </Screen>
    );
  }
  const screen = await loadComposer(mode, query);
  if ("kind" in screen) {
    return (
      <Screen surface="staff" width="review">
        <p role="alert" className="hub-error">
          {screen.message}
        </p>
        <a className="tap hub-link" href={screen.back.href}>
          {screen.back.label}
        </a>
      </Screen>
    );
  }
  return <ComposerBody screen={screen} actions={actions} />;
}
