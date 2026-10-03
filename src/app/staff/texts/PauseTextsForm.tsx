"use client";

import { useActionState } from "react";
import { pauseTextsAction, resumeTextsAction } from "./actions";
import type { TextsState } from "./control";
import { PauseTextsFormView, latestAnswer, type PauseTextsLabels } from "./PauseTextsFormView";

const IDLE: TextsState = { status: "idle" };

/**
 * "Pause all texts" and "Resume texts" (S06.06): the controls of the page, wired to the two server actions. Both are plain form actions,
 * so they work before any script has run. The page re-renders when an action finishes (the switch is read again), which swaps one form for
 * the other; this component stays mounted, so the answer of the press that made the change is still on the screen.
 */
export function PauseTextsForm({ paused, labels, reasonMaxLength }: { paused: boolean; labels: PauseTextsLabels; reasonMaxLength: number }) {
  const [pauseState, pause, pausing] = useActionState(pauseTextsAction, IDLE);
  const [resumeState, resume, resuming] = useActionState(resumeTextsAction, IDLE);
  return (
    <PauseTextsFormView
      paused={paused}
      labels={labels}
      reasonMaxLength={reasonMaxLength}
      answer={latestAnswer(pauseState, resumeState)}
      pausing={pausing}
      resuming={resuming}
      pauseAction={pause}
      resumeAction={resume}
    />
  );
}
