import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../guard";
import { smsTestAvailability, smsTestUnknownAttempts } from "./compose";
import { SendTestTextForm } from "./SendTestTextForm";
import { describeUnknownAttempts } from "./sendTest";
import { SmsTestView } from "./SmsTestView";

export const metadata: Metadata = { title: englishText("staff.smsTest.title") };

/**
 * The first-text spike (S01.15): an Admin sends one test text from production to an approved phone.
 * The policy action `sms.test_send`, Admins only (S01.12); another role sees "Only an Admin can send a
 * test text." and no form, and the action refuses it on its own. On a preview, or wherever SMS_MODE is
 * not live, the button is replaced by "Texts are only sent from production". The approved numbers are
 * never sent to the browser: the form lists masked labels with opaque choices. Attempts whose answer was
 * never recorded are listed as "outcome unknown" (no numbers). E06 removes this page.
 * Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: "/staff/sms-test",
    access: "hub",
    action: "sms.test_send",
    refused: () => (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <Stack gap="related">
            <h1>{englishText("staff.smsTest.title")}</h1>
            <p>{englishText("staff.smsTest.lead")}</p>
          </Stack>
          <p role="alert" className="hub-error">{englishText("staff.smsTest.errors.forbidden")}</p>
        </Stack>
      </Screen>
    ),
  },
  async () => {
    const availability = smsTestAvailability();
    const unknownAttempts = availability.kind === "ready" ? describeUnknownAttempts(await smsTestUnknownAttempts()) : [];
    return (
      <Screen surface="staff">
        <SmsTestView
          availability={availability.kind}
          unknownAttempts={unknownAttempts}
          form={
            availability.kind === "ready" ? (
              <SendTestTextForm
                labels={{
                  number: englishText("staff.smsTest.number"),
                  numberHint: englishText("staff.smsTest.numberHint"),
                  submit: englishText("staff.smsTest.submit"),
                }}
                numbers={availability.numbers}
                requestId={randomUUID()}
              />
            ) : null
          }
        />
      </Screen>
    );
  },
);
