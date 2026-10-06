import { Stack } from "@/ui";
import type { CampaignState } from "./control";

export interface CampaignFormLabels {
  rehearse: string;
  rehearsing: string;
  confirm: string;
  start: string;
  starting: string;
  reopen: string;
  reopening: string;
}

/** The latest of the buttons' answers: each form keeps its own state, and a stale answer of another button must not be shown. */
export function latestAnswer(...states: CampaignState[]): CampaignState {
  return states.reduce<CampaignState>((latest, state) => (state.status === "idle" ? latest : latest.status === "idle" || state.at >= latest.at ? state : latest), { status: "idle" });
}

const ERROR_ID = "campaign-error";

/** What the last press said: always in the page (a live region must exist before its text does); a refusal is an alert in the Hub's error style. */
export function CampaignAnswerView({ answer }: { answer: CampaignState }) {
  return (
    <>
      <div aria-live="polite" data-testid="campaign-answer">
        {answer.status === "done" ? (
          <Stack gap="related">
            {answer.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </Stack>
        ) : null}
      </div>
      {answer.status === "refused" ? (
        <p id={ERROR_ID} role="alert" className="hub-error" data-testid="campaign-error">
          {answer.message}
        </p>
      ) : null}
    </>
  );
}

/**
 * "Rehearse on the drill roster" (S09.07), as it is drawn: the page's idempotency key and the deadline it showed go with the press, so a retried request changes
 * nothing and a deadline that turned since is refused. No behaviour, so the tests draw the very same markup.
 */
export function RehearseFormView({ labels, requestKey, deadlineDate, pending = false, action }: { labels: CampaignFormLabels; requestKey: string; deadlineDate: string; pending?: boolean; action?: (formData: FormData) => void }) {
  return (
    <form action={action}>
      <input type="hidden" name="key" value={requestKey} />
      <input type="hidden" name="deadline" value={deadlineDate} />
      <div>
        <button className="hub-button hub-button--secondary" type="submit" disabled={pending}>
          {pending ? labels.rehearsing : labels.rehearse}
        </button>
      </div>
    </form>
  );
}

/** "Start the campaign": the box the Admin ticks, with the page's idempotency key and the deadline it showed. */
export function StartFormView({ labels, requestKey, deadlineDate, pending = false, action }: { labels: CampaignFormLabels; requestKey: string; deadlineDate: string; pending?: boolean; action?: (formData: FormData) => void }) {
  return (
    <form action={action} className="hub-form">
      <input type="hidden" name="key" value={requestKey} />
      <input type="hidden" name="deadline" value={deadlineDate} />
      <Stack gap="stack">
        <label className="hub-check">
          <input type="checkbox" name="confirm" value="yes" required />
          <span>{labels.confirm}</span>
        </label>
        <div>
          <button className="hub-button hub-button--primary" type="submit" disabled={pending}>
            {pending ? labels.starting : labels.start}
          </button>
        </div>
      </Stack>
    </form>
  );
}

/** "Reopen sign-ups for the MVP" (the button carries no input). */
export function ReopenFormView({ labels, pending = false, action }: { labels: CampaignFormLabels; pending?: boolean; action?: (formData: FormData) => void }) {
  return (
    <form action={action}>
      <div>
        <button className="hub-button hub-button--secondary" type="submit" disabled={pending}>
          {pending ? labels.reopening : labels.reopen}
        </button>
      </div>
    </form>
  );
}
