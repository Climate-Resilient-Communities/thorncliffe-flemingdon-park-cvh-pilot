// The one render of the update composers' pages (S05.01): "Add an update" (O-14, /staff/alerts/update) and "Promote to full alert" (O-13,
// /staff/alerts/promote). Server only; the pages themselves are staffPage()s (the guard).
import { Screen } from "@/ui";
import { pullBackAction, saveDraftAction, startUpdateAction } from "../composer/actions";
import { ComposerBody } from "../composer/ComposerBody";
import type { ComposerQuery } from "../composer/loadComposer";
import { loadUpdate } from "./loadUpdate";

const actions = { save: saveDraftAction, pullBack: pullBackAction, start: startUpdateAction };

export async function UpdatePage({ flavor, query }: { flavor: "update" | "promote"; query: ComposerQuery }) {
  const screen = await loadUpdate(flavor, query);
  if ("kind" in screen) {
    return (
      <Screen surface="staff" width="review">
        <p role="alert" className="hub-error" data-testid={`update-${screen.kind}`}>
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
