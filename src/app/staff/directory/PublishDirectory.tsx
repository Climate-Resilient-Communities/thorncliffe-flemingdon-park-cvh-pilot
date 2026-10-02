"use client";

import { useActionState } from "react";
import { Stack } from "@/ui";
import { publishDirectoryAction } from "./actions";
import type { PublishState } from "./publishRelease";

export interface PublishDirectoryLabels {
  publish: string;
  publishing: string;
  publishHint: string;
}

const IDLE: PublishState = { status: "idle" };

/**
 * The Admin's "Publish directory" button (S02.05) and what it answers. The status region is always in the page (a
 * live region must exist before its text does); a failure is a separate alert in the Hub's error style. The release
 * stays current until the new one is complete, so pressing it is safe at any time.
 */
export function PublishDirectory({ labels }: { labels: PublishDirectoryLabels }) {
  const [state, publish, pending] = useActionState(publishDirectoryAction, IDLE);
  return (
    <Stack gap="related" testId="publish-directory">
      <form action={publish}>
        <Stack gap="label">
          <div>
            <button className="hub-button hub-button--primary" type="submit" disabled={pending} aria-describedby="publish-hint">
              {pending ? labels.publishing : labels.publish}
            </button>
          </div>
          <small id="publish-hint">{labels.publishHint}</small>
        </Stack>
      </form>
      <Stack gap="related" testId="publish-answer">
        <p role="status" data-testid="publish-message">
          {state.status === "done" ? state.message : null}
        </p>
        {state.status === "done" ? (
          <>
            {state.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </>
        ) : null}
        {state.status === "refused" ? (
          <div role="alert" data-testid="publish-error">
            <p className="hub-error">{state.message}</p>
            {state.problems ? <p>{state.problems}</p> : null}
          </div>
        ) : null}
      </Stack>
    </Stack>
  );
}
