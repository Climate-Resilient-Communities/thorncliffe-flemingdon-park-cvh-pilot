import { Stack } from "@/ui";
import type { HandleState } from "./control";

/** The form's words and the longest note, resolved on the server (the catalog never reaches the browser). */
export interface HandleLabels {
  heading: string;
  note: string;
  noteHint: string;
  mark: string;
  marking: string;
  noteMax: number;
}

const NOTE_HINT_ID = "escalation-note-hint";
const ERROR_ID = "escalation-error";

/**
 * "Mark handled" on an escalation's page (S08.08), as it is drawn: the answer region (always in the page, as a live region must exist before its text does), a
 * refusal in the Hub's error style, and, while the escalation is open, the one-line note and the button. No behaviour, so the tests draw the very same markup.
 */
export function HandleFormView({
  id,
  open,
  labels,
  answer,
  pending = false,
  action,
}: {
  id: string;
  open: boolean;
  labels: HandleLabels;
  answer: HandleState;
  pending?: boolean;
  action?: (formData: FormData) => void;
}) {
  return (
    <Stack gap="related" testId="escalation-handle">
      <div aria-live="polite" data-testid="escalation-answer">
        {answer.status === "done" ? <p>{answer.line}</p> : null}
      </div>
      {answer.status === "refused" ? (
        <p id={ERROR_ID} role="alert" className="hub-error" data-testid="escalation-error">
          {answer.message}
        </p>
      ) : null}
      {open && (
        <form action={action} className="hub-form">
          <Stack gap="stack">
            <h2>{labels.heading}</h2>
            <input type="hidden" name="id" value={id} />
            <Stack gap="label">
              <label htmlFor="escalation-note">{labels.note}</label>
              <input
                className="hub-input"
                id="escalation-note"
                name="note"
                type="text"
                autoComplete="off"
                required
                maxLength={labels.noteMax}
                aria-describedby={answer.status === "refused" ? `${NOTE_HINT_ID} ${ERROR_ID}` : NOTE_HINT_ID}
              />
              <small id={NOTE_HINT_ID}>{labels.noteHint}</small>
            </Stack>
            <div>
              <button className="hub-button hub-button--primary" type="submit" disabled={pending}>
                {pending ? labels.marking : labels.mark}
              </button>
            </div>
          </Stack>
        </form>
      )}
    </Stack>
  );
}
