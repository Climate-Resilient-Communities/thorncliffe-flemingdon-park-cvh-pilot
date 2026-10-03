import { Stack } from "@/ui";
import type { TextsState } from "./control";

export interface PauseTextsLabels {
  reason: string;
  reasonHint: string;
  pause: string;
  pausing: string;
  resume: string;
  resuming: string;
  resumeHint: string;
}

/** The later of the two buttons' answers: each form keeps its own state, and a stale answer of the other button must not be shown. */
export function latestAnswer(a: TextsState, b: TextsState): TextsState {
  if (a.status === "idle") return b;
  if (b.status === "idle") return a;
  return a.at >= b.at ? a : b;
}

const HINT_ID = "texts-reason-hint";
const RESUME_HINT_ID = "texts-resume-hint";
const ERROR_ID = "texts-error";

/**
 * The Pause texts page's controls (S06.06), as they are drawn: while texts are going out, one field for the reason and "Pause all texts";
 * while they are paused, "Resume texts" (a second press of either is harmless, and says so). It holds no behaviour, so the tests draw the
 * very same markup. The answer region is always in the page (a live region must exist before its text does); a refusal is a separate alert
 * in the Hub's error style, and says in as many words that nothing changed.
 */
export function PauseTextsFormView({
  paused,
  labels,
  reasonMaxLength,
  answer,
  pausing = false,
  resuming = false,
  pauseAction,
  resumeAction,
}: {
  paused: boolean;
  labels: PauseTextsLabels;
  /** The longest reason (the messaging module's PAUSE_REASON_MAX_CHARS, given by the server page: this file ships to the browser and imports no module). */
  reasonMaxLength: number;
  /** The latest answer of either button (the form component picks the later of the two). */
  answer: TextsState;
  pausing?: boolean;
  resuming?: boolean;
  pauseAction?: (formData: FormData) => void;
  resumeAction?: (formData: FormData) => void;
}) {
  return (
    <Stack gap="stack" testId="texts-controls">
      <div aria-live="polite" data-testid="texts-answer">
        {answer.status === "done" ? (
          <Stack gap="related">
            {answer.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </Stack>
        ) : null}
      </div>
      {answer.status === "refused" ? (
        <p id={ERROR_ID} role="alert" className="hub-error" data-testid="texts-error">
          {answer.message}
        </p>
      ) : null}
      {paused ? (
        <form action={resumeAction}>
          <Stack gap="label">
            <div>
              <button className="hub-button hub-button--primary" type="submit" disabled={resuming} aria-describedby={RESUME_HINT_ID}>
                {resuming ? labels.resuming : labels.resume}
              </button>
            </div>
            <small id={RESUME_HINT_ID}>{labels.resumeHint}</small>
          </Stack>
        </form>
      ) : (
        <form action={pauseAction} className="hub-form">
          <Stack gap="stack">
            <Stack gap="label">
              <label htmlFor="texts-reason">{labels.reason}</label>
              <textarea
                className="hub-input"
                id="texts-reason"
                name="reason"
                rows={3}
                required
                maxLength={reasonMaxLength}
                aria-describedby={answer.status === "refused" ? `${HINT_ID} ${ERROR_ID}` : HINT_ID}
              />
              <small id={HINT_ID}>{labels.reasonHint}</small>
            </Stack>
            <div>
              <button className="hub-button hub-button--primary" type="submit" disabled={pausing}>
                {pausing ? labels.pausing : labels.pause}
              </button>
            </div>
          </Stack>
        </form>
      )}
    </Stack>
  );
}
