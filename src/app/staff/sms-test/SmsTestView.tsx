import type { ReactNode } from "react";
import { englishText } from "@/i18n/text";
import { Stack } from "@/ui";

/**
 * The Test text page's body (S01.15), as it is drawn: the heading, the notice for a preview or an environment that is
 * not set up, the form where texts can be sent, and the attempts whose outcome is unknown. No behaviour, so the
 * page's screenshots (e2e/hub/sms-test.spec.ts) draw the very same markup.
 */
export function SmsTestView({
  availability,
  form,
  unknownAttempts = [],
}: {
  availability: "preview" | "not_configured" | "ready";
  /** The form, only where `availability` is "ready". */
  form?: ReactNode;
  /** One line per attempt whose answer was never recorded (no numbers). */
  unknownAttempts?: readonly string[];
}) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <h1>{englishText("staff.smsTest.title")}</h1>
        <p>{englishText("staff.smsTest.lead")}</p>
      </Stack>
      {availability === "preview" ? <p>{englishText("staff.smsTest.previewOnly")}</p> : null}
      {availability === "not_configured" ? <p role="status">{englishText("staff.smsTest.notConfigured")}</p> : null}
      {availability === "ready" ? form : null}
      {availability === "ready" && unknownAttempts.length > 0 ? (
        <Stack gap="related">
          <h2>{englishText("staff.smsTest.unknown.heading")}</h2>
          <p>{englishText("staff.smsTest.unknown.lead")}</p>
          <ul>
            {unknownAttempts.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Stack>
      ) : null}
    </Stack>
  );
}
