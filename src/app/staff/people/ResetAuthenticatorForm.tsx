"use client";

import { useActionState } from "react";
import { Stack } from "@/ui";
import { resetAuthenticatorAction } from "./actions";
import type { ResetAuthenticatorState } from "./resetAuthenticator";

export interface ResetAuthenticatorLabels {
  title: string;
  lead: string;
  username: string;
  submit: string;
}

const ERROR_ID = "reset-authenticator-error";

/** "Reset authenticator" (S01.11): an Admin names the Coordinator or Admin who lost their phone. */
export function ResetAuthenticatorForm({ labels, initialState = { status: "idle" } }: { labels: ResetAuthenticatorLabels; initialState?: ResetAuthenticatorState }) {
  const [state, formAction, pending] = useActionState(resetAuthenticatorAction, initialState);
  return (
    <section aria-labelledby="reset-authenticator-title">
      <Stack gap="related">
        <h2 id="reset-authenticator-title">{labels.title}</h2>
        <p>{labels.lead}</p>
        {state.status === "reset" ? (
          <div aria-live="polite">
            <Stack gap="related">
              <p>{state.done}</p>
              <p>{state.line}</p>
              {state.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
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
                <label htmlFor="reset-authenticator-username">{labels.username}</label>
                <input
                  className="tap"
                  id="reset-authenticator-username"
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
