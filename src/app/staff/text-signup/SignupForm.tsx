"use client";

import { useActionState } from "react";
import { assistedSignupAction } from "./actions";
import type { SignupState } from "./control";
import { SignupFormView, type SignupFormProps } from "./SignupFormView";

const IDLE: SignupState = { status: "idle" };

/**
 * The Text sign-up form (S07.03), wired to its server action. A plain form action, so it works before any script has run (the building's
 * floors and the neighbourhood it sets need the script; without it the neighbourhood is chosen by hand). The answer stays on the screen.
 */
export function SignupForm(props: SignupFormProps) {
  const [state, send, sending] = useActionState(assistedSignupAction, IDLE);
  return <SignupFormView {...props} answer={state} busy={sending} action={send} />;
}
