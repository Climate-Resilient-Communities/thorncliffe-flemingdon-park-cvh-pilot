import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../guard";
import { smsTestAvailability } from "./compose";
import { SendTestTextForm } from "./SendTestTextForm";

export const metadata: Metadata = { title: englishText("staff.smsTest.title") };

function Heading() {
  return (
    <Stack gap="related">
      <h1>{englishText("staff.smsTest.title")}</h1>
      <p>{englishText("staff.smsTest.lead")}</p>
    </Stack>
  );
}

/**
 * The first-text spike (S01.15): an Admin sends one test text from production to an approved phone.
 * The policy action `sms.test_send`, Admins only (S01.12); another role sees "Only an Admin can send a
 * test text." and no form, and the action refuses it on its own. On a preview, or wherever SMS_MODE is
 * not live, the button is replaced by "Texts are only sent from production". E06 removes this page.
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
          <Heading />
          <p role="alert">{englishText("staff.smsTest.errors.forbidden")}</p>
        </Stack>
      </Screen>
    ),
  },
  async () => {
    const availability = smsTestAvailability();
    return (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <Heading />
          {availability.kind === "preview" ? <p>{englishText("staff.smsTest.previewOnly")}</p> : null}
          {availability.kind === "not_configured" ? <p role="status">{englishText("staff.smsTest.notConfigured")}</p> : null}
          {availability.kind === "ready" ? (
            <SendTestTextForm
              labels={{
                number: englishText("staff.smsTest.number"),
                numberHint: englishText("staff.smsTest.numberHint"),
                submit: englishText("staff.smsTest.submit"),
              }}
              numbers={availability.numbers}
              requestId={randomUUID()}
            />
          ) : null}
        </Stack>
      </Screen>
    );
  },
);
