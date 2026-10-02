"use client";

import { useActionState } from "react";
import { Stack } from "@/ui";
import { resetPasswordAction } from "./actions";
import type { ResetPasswordState } from "./resetPassword";

export interface ResetPasswordLabels {
  title: string;
  lead: string;
  username: string;
  submit: string;
}

const ERROR_ID = "reset-password-error";

/** "Reset password" (S01.08): an Admin names the account; the result shows the new starting password once. */
export function ResetPasswordForm({ labels, initialState = { status: "idle" } }: { labels: ResetPasswordLabels; initialState?: ResetPasswordState }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);
  return (
    <section aria-labelledby="reset-password-title">
      <Stack gap="related">
        <h2 id="reset-password-title">{labels.title}</h2>
        <p>{labels.lead}</p>
        {state.status === "reset" ? (
          <div aria-live="polite">
            <Stack gap="related">
              <p>{state.done}</p>
              <p>{state.line}</p>
            </Stack>
          </div>
        ) : (
          <form action={formAction} key={state.status === "refused" ? JSON.stringify(state) : "new"}>
            <Stack gap="stack">
              {state.status === "refused" && (
                <p id={ERROR_ID} role="alert">
                  {state.message}
                </p>
              )}
              <Stack gap="label">
                <label htmlFor="reset-password-username">{labels.username}</label>
                <input
                  className="tap"
                  id="reset-password-username"
                  name="username"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  defaultValue={state.status === "refused" ? state.username : undefined}
                  aria-describedby={state.status === "refused" ? ERROR_ID : undefined}
                  aria-invalid={state.status === "refused" || undefined}
                />
              </Stack>
              <button className="tap" type="submit" disabled={pending}>
                {labels.submit}
              </button>
            </Stack>
          </form>
        )}
      </Stack>
    </section>
  );
}
