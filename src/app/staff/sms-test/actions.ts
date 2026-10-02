"use server";

import { englishText } from "@/i18n/text";
import { randomUUID } from "node:crypto";
import { staffAction, type ActionRefusal } from "../guard";
import { smsTestService } from "./compose";
import { sendTestFromForm, type SmsTestState } from "./sendTest";

const REFUSAL_KEYS: Record<Exclude<ActionRefusal, "forbidden" | "bad_request">, string> = {
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.authenticator.required",
};

const refusalMessage = (error: ActionRefusal) => englishText(error === "forbidden" || error === "bad_request" ? "staff.smsTest.errors.forbidden" : REFUSAL_KEYS[error]);

// "Send test text" (S01.15) is the policy action `sms.test_send`: Admins only, and privileged
// (S01.10): the guard refuses any other role, then a session below aal2, before the action's own
// code, whatever the screen showed.
export const sendTestTextAction = staffAction(
  { route: "/staff/sms-test", access: "hub", action: "sms.test_send" },
  async (session, _previous: SmsTestState, form: FormData): Promise<SmsTestState> => sendTestFromForm({ service: smsTestService }, session, form),
  (error): SmsTestState => ({ status: "refused", message: refusalMessage(error), nextRequestId: randomUUID() }),
);
