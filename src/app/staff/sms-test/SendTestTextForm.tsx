"use client";

import { useActionState } from "react";
import { sendTestTextAction } from "./actions";
import { SendTestTextFormView, type SendTestTextLabels } from "./SendTestTextFormView";
import type { SmsTestState } from "./sendTest";

export type { SendTestTextLabels };

/**
 * "Send test text" (S01.15): the approved phones (masked, each an opaque choice), one button. Each press carries a
 * request id made by the server; the answer hands the form the next one, so only a deliberate second press can be a
 * second request. Twilio's answer is shown as it came; nothing is retried.
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
  return <SendTestTextFormView labels={labels} numbers={numbers} requestId={currentRequestId} state={state} pending={pending} formAction={formAction} />;
}
