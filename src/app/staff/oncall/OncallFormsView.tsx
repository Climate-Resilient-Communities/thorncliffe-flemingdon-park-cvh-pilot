import { Inline, Stack } from "@/ui";
import type { OncallState } from "./control";

export interface OncallLabels {
  listHeading: string;
  empty: string;
  emptyConsequence: string;
  hidden: string;
  addHeading: string;
  label: string;
  labelHint: string;
  number: string;
  numberHint: string;
  add: string;
  adding: string;
  remove: string;
  removing: string;
}

/** One entry of the list as the page shows it: the name the Admin gave, the number masked to its last four digits, and the text for its Remove button. */
export interface OncallRow {
  id: string;
  label: string;
  masked: string;
  removeFor: string;
}

/** The later of the two forms' answers: each keeps its own state, and a stale answer of the other must not be shown. */
export function latestAnswer(a: OncallState, b: OncallState): OncallState {
  if (a.status === "idle") return b;
  if (b.status === "idle") return a;
  return a.at >= b.at ? a : b;
}

const LABEL_HINT_ID = "oncall-label-hint";
const NUMBER_HINT_ID = "oncall-number-hint";
const ERROR_ID = "oncall-error";

/**
 * The on-call numbers page's list and forms (S06.07), as they are drawn: the numbers that get the text (each masked to its last four digits,
 * with a Remove button that names it), what an empty list means, and the form that adds one. It holds no behaviour, so the tests draw the very
 * same markup. The answer region is always in the page (a live region must exist before its text does); a refusal is a separate alert in the
 * Hub's error style and says in as many words that nothing changed. No number but its last four digits is ever on this page.
 */
export function OncallFormsView({
  rows,
  labels,
  answer,
  adding = false,
  removing = false,
  addAction,
  removeAction,
}: {
  rows: readonly OncallRow[];
  labels: OncallLabels;
  answer: OncallState;
  adding?: boolean;
  removing?: boolean;
  addAction?: (formData: FormData) => void;
  removeAction?: (formData: FormData) => void;
}) {
  return (
    <Stack gap="section-hub" testId="oncall-controls">
      <div aria-live="polite" data-testid="oncall-answer">
        {answer.status === "done" ? (
          <Stack gap="related">
            {answer.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </Stack>
        ) : null}
      </div>
      {answer.status === "refused" ? (
        <p id={ERROR_ID} role="alert" className="hub-error" data-testid="oncall-error">
          {answer.message}
        </p>
      ) : null}
      <Stack gap="related">
        <h2>{labels.listHeading}</h2>
        {rows.length === 0 ? (
          <div className="hub-flag" role="status" data-testid="oncall-empty">
            <Stack gap="subline">
              <p>
                <strong className="hub-flag__label">{labels.empty}</strong>
              </p>
              <p>{labels.emptyConsequence}</p>
            </Stack>
          </div>
        ) : (
          <Stack gap="stack" as="ul" testId="oncall-list">
            {rows.map((row) => (
              <li key={row.id} data-testid="oncall-row">
                <Inline gap="stack" align="center" justify="between">
                  <Stack gap="subline">
                    <strong>{row.label}</strong>
                    <span>{row.masked}</span>
                  </Stack>
                  <form action={removeAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <button className="hub-button hub-button--secondary" type="submit" disabled={removing} aria-label={row.removeFor}>
                      {removing ? labels.removing : labels.remove}
                    </button>
                  </form>
                </Inline>
              </li>
            ))}
          </Stack>
        )}
        <small>{labels.hidden}</small>
      </Stack>
      <form action={addAction} className="hub-form">
        <Stack gap="stack">
          <h2>{labels.addHeading}</h2>
          <Stack gap="label">
            <label htmlFor="oncall-label">{labels.label}</label>
            <input className="hub-input" id="oncall-label" name="label" type="text" autoComplete="off" required maxLength={40} aria-describedby={LABEL_HINT_ID} />
            <small id={LABEL_HINT_ID}>{labels.labelHint}</small>
          </Stack>
          <Stack gap="label">
            <label htmlFor="oncall-number">{labels.number}</label>
            <input
              className="hub-input"
              id="oncall-number"
              name="number"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              required
              aria-describedby={answer.status === "refused" ? `${NUMBER_HINT_ID} ${ERROR_ID}` : NUMBER_HINT_ID}
            />
            <small id={NUMBER_HINT_ID}>{labels.numberHint}</small>
          </Stack>
          <div>
            <button className="hub-button hub-button--primary" type="submit" disabled={adding}>
              {adding ? labels.adding : labels.add}
            </button>
          </div>
        </Stack>
      </form>
    </Stack>
  );
}
