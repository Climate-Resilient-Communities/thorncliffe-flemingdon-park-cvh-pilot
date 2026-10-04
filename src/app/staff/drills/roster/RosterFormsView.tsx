import { Inline, Stack } from "@/ui";
import type { RosterState } from "./control";

export interface RosterLabels {
  listHeading: string;
  empty: string;
  emptyConsequence: string;
  hidden: string;
  addHeading: string;
  label: string;
  labelHint: string;
  number: string;
  numberHint: string;
  language: string;
  add: string;
  adding: string;
  edit: string;
  editNumberHint: string;
  save: string;
  saving: string;
  remove: string;
  removing: string;
}

/** One phone of the list as the page shows it: the name the Admin gave, the number masked to its last four digits, the language of its drill text, and the texts for its buttons. */
export interface RosterRow {
  id: string;
  label: string;
  masked: string;
  lang: string;
  languageLine: string;
  editFor: string;
  removeFor: string;
}

export interface LanguageOption {
  code: string;
  name: string;
}

/** The later of the forms' answers: each keeps its own state, and a stale answer of another must not be shown. */
export function latestAnswer(...states: readonly RosterState[]): RosterState {
  return states.reduce<RosterState>((latest, state) => (state.status === "idle" ? latest : latest.status === "idle" || state.at > latest.at ? state : latest), { status: "idle" });
}

const LABEL_HINT_ID = "drill-roster-label-hint";
const NUMBER_HINT_ID = "drill-roster-number-hint";
const ERROR_ID = "drill-roster-error";

function LanguageSelect({ id, value, options, label }: { id: string; value: string; options: readonly LanguageOption[]; label: string }) {
  return (
    <Stack gap="label">
      <label htmlFor={id}>{label}</label>
      <select className="hub-input" id={id} name="lang" defaultValue={value} required>
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.name}
          </option>
        ))}
      </select>
    </Stack>
  );
}

/**
 * The drill roster page's list and forms (S06.05), as they are drawn: the phones that get drill texts (each masked to its last four digits, with the language of its
 * drill text, an Edit form and a Remove button that names it), what an empty roster means, and the form that adds one. It holds no behaviour, so the tests draw the very
 * same markup. The answer region is always in the page (a live region must exist before its text does); a refusal is a separate alert in the Hub's error style and
 * says in as many words that nothing changed. No number but its last four digits is ever on this page, and an Edit form never holds the number it would keep.
 */
export function RosterFormsView({
  rows,
  languages,
  labels,
  answer,
  busy = false,
  addAction,
  editAction,
  removeAction,
}: {
  rows: readonly RosterRow[];
  languages: readonly LanguageOption[];
  labels: RosterLabels;
  answer: RosterState;
  busy?: boolean;
  addAction?: (formData: FormData) => void;
  editAction?: (formData: FormData) => void;
  removeAction?: (formData: FormData) => void;
}) {
  return (
    <Stack gap="section-hub" testId="drill-roster-controls">
      <div aria-live="polite" data-testid="drill-roster-answer">
        {answer.status === "done" ? (
          <Stack gap="related">
            {answer.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </Stack>
        ) : null}
      </div>
      {answer.status === "refused" ? (
        <p id={ERROR_ID} role="alert" className="hub-error" data-testid="drill-roster-error">
          {answer.message}
        </p>
      ) : null}
      <Stack gap="related">
        <h2>{labels.listHeading}</h2>
        {rows.length === 0 ? (
          <div className="hub-flag" role="status" data-testid="drill-roster-empty">
            <Stack gap="subline">
              <p>
                <strong className="hub-flag__label">{labels.empty}</strong>
              </p>
              <p>{labels.emptyConsequence}</p>
            </Stack>
          </div>
        ) : (
          <Stack gap="stack" as="ul" testId="drill-roster-list">
            {rows.map((row) => (
              <li key={row.id} className="hub-list-item" data-testid="drill-roster-row">
                <Stack gap="related">
                  <Inline gap="stack" align="center" justify="between">
                    <Stack gap="subline">
                      <strong className="hub-wrap">{row.label}</strong>
                      <span>{row.masked}</span>
                      <span className="hub-wrap">{row.languageLine}</span>
                    </Stack>
                    <form action={removeAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <button className="hub-button hub-button--secondary" type="submit" disabled={busy} aria-label={row.removeFor}>
                        {busy ? labels.removing : labels.remove}
                      </button>
                    </form>
                  </Inline>
                  <details>
                    <summary className="tap" aria-label={row.editFor}>
                      {labels.edit}
                    </summary>
                    <form action={editAction} className="hub-form">
                      <Stack gap="stack">
                        <input type="hidden" name="id" value={row.id} />
                        <Stack gap="label">
                          <label htmlFor={`drill-roster-label-${row.id}`}>{labels.label}</label>
                          <input className="hub-input" id={`drill-roster-label-${row.id}`} name="label" type="text" autoComplete="off" required maxLength={40} defaultValue={row.label} />
                        </Stack>
                        <Stack gap="label">
                          <label htmlFor={`drill-roster-number-${row.id}`}>{labels.number}</label>
                          <input
                            className="hub-input"
                            id={`drill-roster-number-${row.id}`}
                            name="number"
                            type="tel"
                            inputMode="tel"
                            autoComplete="off"
                            aria-describedby={`drill-roster-number-hint-${row.id}`}
                          />
                          <small id={`drill-roster-number-hint-${row.id}`}>{labels.editNumberHint}</small>
                        </Stack>
                        <LanguageSelect id={`drill-roster-lang-${row.id}`} value={row.lang} options={languages} label={labels.language} />
                        <div>
                          <button className="hub-button hub-button--primary" type="submit" disabled={busy}>
                            {busy ? labels.saving : labels.save}
                          </button>
                        </div>
                      </Stack>
                    </form>
                  </details>
                </Stack>
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
            <label htmlFor="drill-roster-label">{labels.label}</label>
            <input className="hub-input" id="drill-roster-label" name="label" type="text" autoComplete="off" required maxLength={40} aria-describedby={LABEL_HINT_ID} />
            <small id={LABEL_HINT_ID}>{labels.labelHint}</small>
          </Stack>
          <Stack gap="label">
            <label htmlFor="drill-roster-number">{labels.number}</label>
            <input
              className="hub-input"
              id="drill-roster-number"
              name="number"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              required
              aria-describedby={answer.status === "refused" ? `${NUMBER_HINT_ID} ${ERROR_ID}` : NUMBER_HINT_ID}
            />
            <small id={NUMBER_HINT_ID}>{labels.numberHint}</small>
          </Stack>
          <LanguageSelect id="drill-roster-lang" value="en" options={languages} label={labels.language} />
          <div>
            <button className="hub-button hub-button--primary" type="submit" disabled={busy}>
              {busy ? labels.adding : labels.add}
            </button>
          </div>
        </Stack>
      </form>
    </Stack>
  );
}
