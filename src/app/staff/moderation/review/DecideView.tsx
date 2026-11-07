// O-09's "Decide" and O-10's reasons as they are drawn (PRD §6.3): the answer region (always in the page, as a live region must exist before
// its text does), a refusal in the Hub's error style, and, while the suggestion waits, either Accept with what accepting does and the way to
// decline, or (on `?decline=1`) the six pre-written reasons with what the resident reads for each, the Hub's optional note, and Send. No
// behaviour, so the tests draw the very same markup the page does; DecideForms wires it to the server actions. Its words come resolved
// (labels.ts, on the server): this file reaches the browser through DecideForms, and the catalog never does.
import { DECLINE_NOTE_MAX_CHARS } from "@/contracts/placeSubmission";
import { Stack } from "@/ui";
import type { DecideState } from "./decide";

export interface DecideLabels {
  decideTitle: string;
  accept: string;
  accepting: string;
  acceptLine: string;
  declineLink: string;
  declineLine: string;
  declineTitle: string;
  declineLead: string;
  reasonsTitle: string;
  suggested: string;
  note: string;
  noteHint: string;
  send: string;
  declining: string;
  cancel: string;
  toQueue: string;
}

export interface DecideReason {
  id: string;
  label: string;
  line: string;
  suggested: boolean;
}

const NOTE_HINT_ID = "moderation-note-hint";
const ERROR_ID = "moderation-error";

export function DecideView({
  id,
  waiting,
  declining,
  reasons,
  labels,
  hrefs,
  answer,
  pending = null,
  accept,
  decline,
}: {
  id: string;
  /** The suggestion still waits for a decision: the forms are shown. */
  waiting: boolean;
  /** `?decline=1`: O-10's reasons instead of Accept. */
  declining: boolean;
  reasons: readonly DecideReason[];
  labels: DecideLabels;
  hrefs: { decline: string; review: string; queue: string; next: { href: string; label: string } | null };
  answer: DecideState;
  pending?: "accept" | "decline" | null;
  accept?: (formData: FormData) => void;
  decline?: (formData: FormData) => void;
}) {
  return (
    <Stack gap="related" testId="moderation-decide">
      <div aria-live="polite" data-testid="moderation-answer">
        {answer.status === "done" && (
          <Stack gap="related">
            <p>
              <strong>{answer.message}</strong>
            </p>
            <p>
              {hrefs.next ? (
                <a className="tap hub-button hub-button--primary" href={hrefs.next.href} data-testid="moderation-next">
                  {hrefs.next.label}
                </a>
              ) : (
                <a className="tap hub-button hub-button--secondary" href={hrefs.queue} data-testid="moderation-to-queue">
                  {labels.toQueue}
                </a>
              )}
            </p>
          </Stack>
        )}
      </div>
      {answer.status === "refused" && (
        <p id={ERROR_ID} role="alert" className="hub-error" data-testid="moderation-error">
          {answer.message}
        </p>
      )}
      {waiting && answer.status !== "done" && !declining && (
        <section aria-labelledby="moderation-decide-title" className="hub-form">
          <Stack gap="related">
            <h2 id="moderation-decide-title">{labels.decideTitle}</h2>
            <form action={accept}>
              <Stack gap="related">
                <input type="hidden" name="id" value={id} />
                <div>
                  <button className="hub-button hub-button--primary" type="submit" disabled={pending !== null} data-testid="moderation-accept">
                    {pending === "accept" ? labels.accepting : labels.accept}
                  </button>
                </div>
                <p>{labels.acceptLine}</p>
              </Stack>
            </form>
            <div>
              <a className="tap hub-button hub-button--secondary" href={hrefs.decline} data-testid="moderation-decline-link">
                {labels.declineLink}
              </a>
            </div>
            <p>{labels.declineLine}</p>
          </Stack>
        </section>
      )}
      {waiting && answer.status !== "done" && declining && (
        <form action={decline} className="hub-form" data-testid="moderation-decline-form">
          <Stack gap="stack">
            <Stack gap="related">
              <h2 className="hub-wrap">{labels.declineTitle}</h2>
              <p>{labels.declineLead}</p>
            </Stack>
            <input type="hidden" name="id" value={id} />
            <Stack as="fieldset" gap="related">
              <legend>
                <strong>{labels.reasonsTitle}</strong>
              </legend>
              {reasons.map((reason) => (
                <label key={reason.id} className="hub-check" data-testid={`moderation-reason-${reason.id}`}>
                  <input type="radio" name="reason" value={reason.id} required defaultChecked={reason.suggested} />
                  <span>
                    <strong>{reason.label}</strong>
                    {reason.suggested && <> ({labels.suggested})</>}
                    <br />
                    {reason.line}
                  </span>
                </label>
              ))}
            </Stack>
            <Stack gap="label">
              <label htmlFor="moderation-note">{labels.note}</label>
              <textarea
                className="hub-input"
                id="moderation-note"
                name="note"
                rows={3}
                maxLength={DECLINE_NOTE_MAX_CHARS}
                aria-describedby={answer.status === "refused" ? `${NOTE_HINT_ID} ${ERROR_ID}` : NOTE_HINT_ID}
              />
              <small id={NOTE_HINT_ID}>{labels.noteHint}</small>
            </Stack>
            <div className="hub-wrap">
              <button className="hub-button hub-button--primary" type="submit" disabled={pending !== null} data-testid="moderation-send">
                {pending === "decline" ? labels.declining : labels.send}
              </button>{" "}
              <a className="tap hub-button hub-button--secondary" href={hrefs.review}>
                {labels.cancel}
              </a>
            </div>
          </Stack>
        </form>
      )}
    </Stack>
  );
}
