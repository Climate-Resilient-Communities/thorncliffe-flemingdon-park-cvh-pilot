import type { ReactNode } from "react";
import { englishText } from "@/i18n/text";
import { Stack } from "@/ui";
import { countLine } from "./view";

const t = (key: string) => englishText(`staff.oncall.${key}`);

/**
 * The on-call numbers page's body (S06.07), as it is drawn: the heading, who gets the text and the rule that an alert needs a number once
 * texts are live, how many numbers are on the list, and the list and forms. `unreadable` is a roster the Hub could not read: the page says so and
 * still offers the forms, because a change is judged by the database either way. No behaviour, so the tests draw the very same markup.
 */
export function OncallView({ count, unreadable = false, forms }: { count: number; unreadable?: boolean; forms: ReactNode }) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <h1>{t("title")}</h1>
        <p>{t("lead")}</p>
        <p data-testid="oncall-rule">{t("rule")}</p>
      </Stack>
      {unreadable ? (
        <p role="alert" className="hub-error" data-testid="oncall-unreadable">
          {t("errors.unreadable")}
        </p>
      ) : (
        <p role="status" data-testid="oncall-count">
          {countLine(count)}
        </p>
      )}
      {forms}
    </Stack>
  );
}
