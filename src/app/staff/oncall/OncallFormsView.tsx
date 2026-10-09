import { Inline, Stack } from "@/ui";
import type { OncallState } from "./control";
import type { OnDutyView } from "./view";

/** The on-duty section's words (S08.08), resolved on the server. */
export interface OnDutyLabels {
  heading: string;
  lead: string;
  badge: string;
  number: string;
  account: string;
  accountHint: string;
  noAccount: string;
  noNumber: string;
  set: string;
  setting: string;
  clear: string;
  clearing: string;
}

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
  /** S08.08: the on-duty section's words; left out, the section is not drawn. */
  onDuty?: OnDutyLabels;
}

/** One entry of the list as the page shows it: the name the Admin gave, the number masked to its last four digits, and the text for its Remove button. */
export interface OncallRow {
  id: string;
  label: string;
  masked: string;
  removeFor: string;
  /** S08.08: the entry of the Admin on duty for check-ins. */
  onDuty?: boolean;
}

/**
 * What the forms show of the latest answer (UAT F-1): a refusal stays until the person changes a field of the add form, then it goes, so a number typed again
 * is never shown beside the refusal of the one before. `dismissed` is the time of the answer the person typed after (null for none).
 */
export function shownAnswer(answer: OncallState, dismissed: number | null): OncallState {
  return answer.status === "refused" && answer.at === dismissed ? { status: "idle" } : answer;
}

/**
 * The add form's fields after an answer (UAT F-1): emptied once a number was added; as typed after a refusal or any other press.
 */
export function fieldsAfter(answer: OncallState, fields: { label: string; number: string }): { label: string; number: string } {
  return answer.status === "done" ? { label: "", number: "" } : fields;
}

/** The latest of the forms' answers: each keeps its own state, and a stale answer of another must not be shown. */
export function latestAnswer(...answers: OncallState[]): OncallState {
  let latest: OncallState = { status: "idle" };
  for (const answer of answers) {
    if (answer.status === "idle") continue;
    if (latest.status === "idle" || answer.at > latest.at) latest = answer;
  }
  return latest;
}

/**
 * The add form's two fields as the person typed them (UAT F-1): kept as typed after a refusal, so only what was wrong is retyped, and emptied once a number was added.
 * Held in the page's memory only (OncallForms.tsx); the server never sends a number back. Left out, the fields hold what is typed themselves.
 */
export interface AddFields {
  label: string;
  number: string;
  onChange: (field: "label" | "number", value: string) => void;
}

const LABEL_HINT_ID = "oncall-label-hint";
const NUMBER_HINT_ID = "oncall-number-hint";
const ACCOUNT_HINT_ID = "oncall-account-hint";
const ERROR_ID = "oncall-error";

/**
 * The on-duty section (S08.08): what is set now, then the choice of a number on the list and an Admin account that can be on duty, and "Nobody on duty"
 * while someone is. A stale entry (its account no longer an active Admin with an authenticator) is said in the Hub's flag style, as a nobody-on-duty is.
 */
function OnDutySection({
  view,
  labels,
  setting,
  clearing,
  setAction,
  clearAction,
}: {
  view: OnDutyView;
  labels: OnDutyLabels;
  setting: boolean;
  clearing: boolean;
  setAction?: (formData: FormData) => void;
  clearAction?: (formData: FormData) => void;
}) {
  const choosable = view.numbers.length > 0 && view.accounts.length > 0;
  return (
    <section aria-labelledby="oncall-on-duty-title" data-testid="oncall-on-duty">
      <Stack gap="stack">
        <Stack gap="related">
          <h2 id="oncall-on-duty-title">{labels.heading}</h2>
          <p>{labels.lead}</p>
          <p className={view.state === "set" ? "hub-wrap" : "hub-flag hub-wrap"} role="status" data-testid="oncall-on-duty-state" data-state={view.state}>
            {view.line}
          </p>
        </Stack>
        {view.numbers.length === 0 ? (
          <p data-testid="oncall-on-duty-no-number">{labels.noNumber}</p>
        ) : view.accounts.length === 0 ? (
          <p data-testid="oncall-on-duty-no-account">{labels.noAccount}</p>
        ) : null}
        {choosable && (
          <form action={setAction} className="hub-form">
            <Stack gap="stack">
              <Stack gap="label">
                <label htmlFor="oncall-on-duty-number">{labels.number}</label>
                <select className="hub-input" id="oncall-on-duty-number" name="id" defaultValue={view.chosenNumber ?? view.numbers[0]?.id} required>
                  {view.numbers.map((number) => (
                    <option key={number.id} value={number.id}>
                      {number.label}
                    </option>
                  ))}
                </select>
              </Stack>
              <Stack gap="label">
                <label htmlFor="oncall-on-duty-account">{labels.account}</label>
                <select className="hub-input" id="oncall-on-duty-account" name="staff_id" defaultValue={view.chosenAccount ?? view.accounts[0]?.id} required aria-describedby={ACCOUNT_HINT_ID}>
                  {view.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
                <small id={ACCOUNT_HINT_ID}>{labels.accountHint}</small>
              </Stack>
              <div>
                <button className="hub-button hub-button--primary" type="submit" disabled={setting}>
                  {setting ? labels.setting : labels.set}
                </button>
              </div>
            </Stack>
          </form>
        )}
        {view.state !== "none" && (
          <form action={clearAction}>
            <button className="hub-button hub-button--secondary" type="submit" disabled={clearing}>
              {clearing ? labels.clearing : labels.clear}
            </button>
          </form>
        )}
      </Stack>
    </section>
  );
}

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
  onDuty,
  setting = false,
  clearing = false,
  setOnDutyAction,
  clearOnDutyAction,
  addFields,
}: {
  rows: readonly OncallRow[];
  labels: OncallLabels;
  answer: OncallState;
  adding?: boolean;
  removing?: boolean;
  addAction?: (formData: FormData) => void;
  removeAction?: (formData: FormData) => void;
  /** S08.08: the on-duty section; drawn with `labels.onDuty`. */
  onDuty?: OnDutyView;
  setting?: boolean;
  clearing?: boolean;
  setOnDutyAction?: (formData: FormData) => void;
  clearOnDutyAction?: (formData: FormData) => void;
  addFields?: AddFields;
}) {
  // Controlled only when the page keeps the fields; the tests and the screenshots draw them as typed into.
  const field = (name: "label" | "number") => (addFields ? { value: addFields[name], onChange: (event: { target: { value: string } }) => addFields.onChange(name, event.target.value) } : {});
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
                    {row.onDuty && labels.onDuty ? (
                      <span className="hub-flag__label" data-testid="oncall-row-on-duty">
                        {labels.onDuty.badge}
                      </span>
                    ) : null}
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
      {onDuty && labels.onDuty ? (
        <OnDutySection view={onDuty} labels={labels.onDuty} setting={setting} clearing={clearing} setAction={setOnDutyAction} clearAction={clearOnDutyAction} />
      ) : null}
      <form action={addAction} className="hub-form">
        <Stack gap="stack">
          <h2>{labels.addHeading}</h2>
          <Stack gap="label">
            <label htmlFor="oncall-label">{labels.label}</label>
            <input className="hub-input" id="oncall-label" name="label" type="text" autoComplete="off" required maxLength={40} aria-describedby={LABEL_HINT_ID} {...field("label")} />
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
              {...field("number")}
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
