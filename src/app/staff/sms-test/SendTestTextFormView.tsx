import { Stack } from "@/ui";
import type { SmsTestState } from "./sendTest";

export interface SendTestTextLabels {
  number: string;
  numberHint: string;
  submit: string;
}

const ERROR_ID = "sms-test-error";
const HINT_ID = "sms-test-hint";

/**
 * "Send test text" (S01.15), as it is drawn: the approved phones, one button, and Twilio's answer. It holds no
 * behaviour, so the page's screenshots (e2e/hub/sms-test.spec.ts) draw the very same markup. Each option's value is
 * an opaque choice made on the server, never a phone number; its label is the masked number.
 */
export function SendTestTextFormView({
  labels,
  numbers,
  requestId,
  state,
  pending = false,
  formAction,
}: {
  labels: SendTestTextLabels;
  numbers: { value: string; label: string }[];
  requestId: string;
  state: SmsTestState;
  pending?: boolean;
  formAction?: (formData: FormData) => void;
}) {
  return (
    <Stack gap="stack">
      {state.status === "sent" || state.status === "failed" ? (
        <div aria-live="polite" role={state.status === "failed" ? "alert" : undefined}>
          <Stack gap="related">
            <h2>{state.heading}</h2>
            {state.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </Stack>
        </div>
      ) : null}
      {state.status === "refused" ? (
        <p id={ERROR_ID} role="alert" className="hub-error">
          {state.message}
        </p>
      ) : null}
      <form action={formAction}>
        <Stack gap="stack">
          <input type="hidden" name="requestId" value={requestId} />
          <Stack gap="label">
            <label htmlFor="sms-test-number">{labels.number}</label>
            <select className="hub-input" id="sms-test-number" name="number" required defaultValue={numbers[0]?.value} aria-describedby={state.status === "refused" ? `${HINT_ID} ${ERROR_ID}` : HINT_ID}>
              {numbers.map((number) => (
                <option key={number.value} value={number.value}>
                  {number.label}
                </option>
              ))}
            </select>
            <p id={HINT_ID}>{labels.numberHint}</p>
          </Stack>
          <button className="hub-button hub-button--primary" type="submit" disabled={pending}>
            {labels.submit}
          </button>
        </Stack>
      </form>
    </Stack>
  );
}
