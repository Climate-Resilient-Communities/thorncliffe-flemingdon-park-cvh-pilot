"use client";

import { useActionState } from "react";
import { Stack } from "@/ui";
import { reissueAction } from "./actions";
import type { ReissueState } from "./reissue";

export interface ReissueLabels {
  title: string;
  lead: string;
  username: string;
  submit: string;
}

const ERROR_ID = "reissue-error";

/** "Re-issue a starting password" (S01.07): an Admin names the account; the result shows what to hand over. */
export function ReissueForm({ labels, initialState = { status: "idle" } }: { labels: ReissueLabels; initialState?: ReissueState }) {
  const [state, formAction, pending] = useActionState(reissueAction, initialState);
  return (
    <section aria-labelledby="reissue-title">
      <Stack gap="related">
        <h2 id="reissue-title">{labels.title}</h2>
        <p>{labels.lead}</p>
        {state.status === "reissued" ? (
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
                <label htmlFor="reissue-username">{labels.username}</label>
                <input
                  className="tap"
                  id="reissue-username"
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
