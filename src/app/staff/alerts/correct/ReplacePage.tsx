// The one render of "Correct" (/staff/alerts/correct) and "Withdraw" (/staff/alerts/withdraw), O-15 (S05.02). Server only; the pages themselves are staffPage()s.
import { Screen } from "@/ui";
import { pullBackAction, saveDraftAction } from "../composer/actions";
import { startCorrectionAction, startWithdrawalAction } from "./actions";
import { ComposerBody } from "../composer/ComposerBody";
import { loadReplace, type ReplaceQuery } from "./loadReplace";

export async function ReplacePage({ mode, query }: { mode: "correct" | "withdraw"; query: ReplaceQuery }) {
  const screen = await loadReplace(mode, query);
  if ("kind" in screen) {
    return (
      <Screen surface="staff" width="review">
        <p role="alert" className="hub-error" data-testid={`replace-${screen.kind}`}>
          {screen.message}
        </p>
        <a className="tap hub-link" href={screen.back.href}>
          {screen.back.label}
        </a>
      </Screen>
    );
  }
  return <ComposerBody screen={screen} actions={{ save: saveDraftAction, pullBack: pullBackAction, start: mode === "correct" ? startCorrectionAction : startWithdrawalAction }} />;
}
