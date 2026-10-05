"use client";

import { useActionState } from "react";
import { setCapAction } from "./actions";
import type { CapState } from "./control";
import { CapFormView, type CapLabels } from "./CapFormView";

const IDLE: CapState = { status: "idle" };

/**
 * The cap form of the spend page (S07.08), wired to the server action. A plain form action, so it works before any script has run. The page re-renders
 * when the action finishes (the cap is read again); this component stays mounted, so the answer of the press that made the change is still on the screen.
 */
export function CapForm({ labels, current }: { labels: CapLabels; current: string }) {
  const [state, save, saving] = useActionState(setCapAction, IDLE);
  return <CapFormView labels={labels} answer={state} current={current} saving={saving} action={save} />;
}
