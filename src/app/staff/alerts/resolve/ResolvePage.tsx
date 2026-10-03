// The one render of "Mark resolved" (/staff/alerts/resolve), O-16 (S05.03). Server only; the page itself is a staffPage() (the guard).
import { Screen } from "@/ui";
import { pullBackAction, saveDraftAction, startFinalAction } from "../composer/actions";
import { ComposerBody } from "../composer/ComposerBody";
import type { ComposerQuery } from "../composer/loadComposer";
import { loadResolve } from "./loadResolve";

const actions = { save: saveDraftAction, pullBack: pullBackAction, start: startFinalAction };

export async function ResolvePage({ query }: { query: ComposerQuery }) {
  const screen = await loadResolve(query);
  if ("kind" in screen) {
    return (
      <Screen surface="staff" width="review">
        <p role="alert" className="hub-error" data-testid={`resolve-${screen.kind}`}>
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
