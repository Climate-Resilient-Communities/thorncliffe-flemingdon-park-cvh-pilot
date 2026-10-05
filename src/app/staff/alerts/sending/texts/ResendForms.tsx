"use client";

import { useActionState } from "react";
import type { ResendAllView, ResendControlView } from "../view";
import { resendAllAction, resendTextAction } from "./actions";
import type { ResendState } from "./control";
import { ResendAllFormView, ResendOneFormView } from "./ResendFormView";

const IDLE: ResendState = { status: "idle" };

/**
 * "Resend" on one text of the list (S09.02), wired to the server action. A plain form action, so it works before any script has run. The list re-renders when the action
 * finishes (the chains are read again); this component stays mounted, so the answer of the press that made the change is still on the screen.
 */
export function ResendOneForm({ view }: { view: ResendControlView }) {
  const [state, resend, resending] = useActionState(resendTextAction, IDLE);
  return <ResendOneFormView view={view} answer={state} saving={resending} action={resend} />;
}

/** "Resend the failed and undelivered texts in {language}", wired to its server action. */
export function ResendAllForm({ view }: { view: ResendAllView }) {
  const [state, resend, resending] = useActionState(resendAllAction, IDLE);
  return <ResendAllFormView view={view} answer={state} saving={resending} action={resend} />;
}
