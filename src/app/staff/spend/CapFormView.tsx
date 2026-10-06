import { Stack } from "@/ui";
import type { CapState } from "./control";

export interface CapLabels {
  label: string;
  hint: string;
  save: string;
  saving: string;
}

const HINT_ID = "spend-cap-hint";
const ERROR_ID = "spend-cap-error";

/**
 * The monthly cap's form (S07.08), as it is drawn: one field for the amount in dollars and "Save cap". It holds no behaviour, so the tests draw the very
 * same markup. The answer region is always in the page (a live region must exist before its text does); a refusal is a separate alert in the Hub's error
 * style and says in as many words that nothing changed. `current` pre-fills the field with the cap now in force, in dollars.
 */
export function CapFormView({
  labels,
  answer,
  current = "",
  saving = false,
  action,
}: {
  labels: CapLabels;
  answer: CapState;
  current?: string;
  saving?: boolean;
  action?: (formData: FormData) => void;
}) {
  return (
    <Stack gap="stack" testId="cap-controls">
      <div aria-live="polite" data-testid="cap-answer">
        {answer.status === "done" ? (
          <Stack gap="related">
            {answer.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </Stack>
        ) : null}
      </div>
      {answer.status === "refused" ? (
        <p id={ERROR_ID} role="alert" className="hub-error" data-testid="cap-error">
          {answer.message}
        </p>
      ) : null}
      <form action={action} className="hub-form">
        <Stack gap="stack">
          <Stack gap="label">
            <label htmlFor="spend-cap">{labels.label}</label>
            <input
              className="hub-input"
              id="spend-cap"
              name="cap"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              required
              defaultValue={current}
              aria-describedby={answer.status === "refused" ? `${HINT_ID} ${ERROR_ID}` : HINT_ID}
            />
            <small id={HINT_ID}>{labels.hint}</small>
          </Stack>
          <div>
            <button className="hub-button hub-button--primary" type="submit" disabled={saving}>
              {saving ? labels.saving : labels.save}
            </button>
          </div>
        </Stack>
      </form>
    </Stack>
  );
}
