import { Stack } from "@/ui";
import type { ResendAllView, ResendControlView } from "../view";
import type { ResendState } from "./control";

/**
 * What a resend form says after a press (S09.02). The answer region is always in the page (a live region must exist before its text does); a refusal is a separate alert in
 * the Hub's error style and says in as many words that nothing was resent.
 */
function Answer({ answer, id }: { answer: ResendState; id: string }) {
  return (
    <>
      <div aria-live="polite" data-testid="resend-answer">
        {answer.status === "done" ? (
          <Stack gap="related">
            {answer.lines.map((line) => (
              <p key={line} className="hub-wrap">
                {line}
              </p>
            ))}
          </Stack>
        ) : null}
      </div>
      {answer.status === "refused" ? (
        <p id={id} role="alert" className="hub-error hub-wrap" data-testid="resend-error">
          {answer.message}
        </p>
      ) : null}
    </>
  );
}

/**
 * "Resend" on one text, as it is drawn: the form carries the entry, the text and the status the Admin saw (the server refuses it if the text is another status by then),
 * and for an `unknown` text a box to tick with the warning that it may arrive twice. It holds no behaviour, so the tests and the screenshots draw the very same markup.
 */
export function ResendOneFormView({
  view,
  answer = { status: "idle" },
  saving = false,
  action,
}: {
  view: ResendControlView;
  answer?: ResendState;
  saving?: boolean;
  action?: (formData: FormData) => void;
}) {
  const confirmId = `resend-confirm-${view.deliveryId}`;
  const errorId = `resend-error-${view.deliveryId}`;
  // A text that has been resent is not pressed again: the next press would only be refused ("a newer text was already made").
  const resent = answer.status === "done";
  return (
    <form action={action} className="hub-form" data-testid="resend-one" aria-describedby={answer.status === "refused" ? errorId : undefined}>
      <Stack gap="related">
        <input type="hidden" name="entry" value={view.entryId} />
        <input type="hidden" name="delivery" value={view.deliveryId} />
        <input type="hidden" name="seen" value={view.seen} />
        {view.confirm ? (
          <label className="hub-check" htmlFor={confirmId}>
            <input id={confirmId} type="checkbox" name="confirm" value="on" required />
            <span>{view.confirm}</span>
          </label>
        ) : null}
        <div>
          <button className="hub-button hub-button--secondary" type="submit" disabled={saving || resent} aria-label={saving ? undefined : view.ariaLabel}>
            {saving ? view.sending : view.label}
          </button>
        </div>
        <Answer answer={answer} id={errorId} />
      </Stack>
    </form>
  );
}

/** "Resend the failed and undelivered texts in {language}", as it is drawn: the entry and the language, and the button. */
export function ResendAllFormView({
  view,
  answer = { status: "idle" },
  saving = false,
  action,
}: {
  view: ResendAllView;
  answer?: ResendState;
  saving?: boolean;
  action?: (formData: FormData) => void;
}) {
  const errorId = `resend-all-error-${view.lang}`;
  return (
    <form action={action} className="hub-form" data-testid={`resend-all-${view.lang}`} aria-describedby={answer.status === "refused" ? errorId : undefined}>
      <Stack gap="related">
        <input type="hidden" name="entry" value={view.entryId} />
        <input type="hidden" name="lang" value={view.lang} />
        <small className="hub-wrap">{view.hint}</small>
        <div>
          <button className="hub-button hub-button--primary" type="submit" disabled={saving}>
            {saving ? view.sending : view.label}
          </button>
        </div>
        <Answer answer={answer} id={errorId} />
      </Stack>
    </form>
  );
}
