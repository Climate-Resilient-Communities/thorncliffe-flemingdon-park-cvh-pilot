"use client";

import { useActionState } from "react";
import { Stack } from "@/ui";
import { sendTestTextAction } from "./actions";
import type { SmsTestState } from "./sendTest";

export interface SendTestTextLabels {
  number: string;
  numberHint: string;
  submit: string;
}

const ERROR_ID = "sms-test-error";
const HINT_ID = "sms-test-hint";

/**
 * "Send test text" (S01.15): the approved phones (masked), one button. Each press carries a request id
 * made by the server; the answer hands the form the next one, so only a deliberate second press can
 * be a second request. Twilio's answer is shown as it came; nothing is retried.
 */
export function SendTestTextForm({
  labels,
  numbers,
  requestId,
  initialState = { status: "idle" },
}: {
  labels: SendTestTextLabels;
  numbers: { value: string; label: string }[];
  requestId: string;
  initialState?: SmsTestState;
}) {
  const [state, formAction, pending] = useActionState(sendTestTextAction, initialState);
  const currentRequestId = state.status === "idle" ? requestId : state.nextRequestId;
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
        <p id={ERROR_ID} role="alert">
          {state.message}
        </p>
      ) : null}
      <form action={formAction}>
        <Stack gap="stack">
          <input type="hidden" name="requestId" value={currentRequestId} />
          <Stack gap="label">
            <label htmlFor="sms-test-number">{labels.number}</label>
            <select className="tap" id="sms-test-number" name="number" required defaultValue={numbers[0]?.value} aria-describedby={state.status === "refused" ? `${HINT_ID} ${ERROR_ID}` : HINT_ID}>
              {numbers.map((number) => (
                <option key={number.value} value={number.value}>
                  {number.label}
                </option>
              ))}
            </select>
            <p id={HINT_ID}>{labels.numberHint}</p>
          </Stack>
          <button className="tap" type="submit" disabled={pending}>
            {labels.submit}
          </button>
        </Stack>
      </form>
    </Stack>
  );
}
