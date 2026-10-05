import type { ReactNode } from "react";
import { englishText } from "@/i18n/text";
import { Stack } from "@/ui";
import type { PeriodView, SpendLine, SpendScreen } from "./view";

function Lines({ lines, testId }: { lines: readonly SpendLine[]; testId: string }) {
  return (
    <Stack gap="related" as="ul" testId={testId}>
      {lines.map((line) => (
        <li key={line.id} data-testid={`line-${line.id}`} className="hub-wrap">
          {line.text}
        </li>
      ))}
    </Stack>
  );
}

function Period({ period }: { period: PeriodView }) {
  return (
    <section aria-labelledby={`spend-${period.id}-heading`} data-testid={`period-${period.id}`}>
      <Stack gap="stack">
        <h2 id={`spend-${period.id}-heading`}>{period.heading}</h2>
        <p data-testid={`total-${period.id}`}>
          <strong>{period.total}</strong>
        </p>
        {period.incomplete ? (
          <p role="note" className="hub-flag hub-wrap" data-testid={`incomplete-${period.id}`}>
            {period.incomplete}
          </p>
        ) : null}
        <Stack gap="related">
          <h3>{period.sms.heading}</h3>
          <Lines lines={period.sms.lines} testId={`sms-${period.id}`} />
          {period.sms.overlap ? <small data-testid={`overlap-${period.id}`}>{period.sms.overlap}</small> : null}
        </Stack>
        <Stack gap="related">
          <h3>{period.cohere.heading}</h3>
          <Lines lines={period.cohere.lines} testId={`cohere-${period.id}`} />
        </Stack>
      </Stack>
    </section>
  );
}

/**
 * The spend page's body (S07.08), as it is drawn: the pilot budget, this month and the pilot to date (text messages and Cohere, every figure labelled
 * as the actual, an unmatched actual, an unresolved estimate, a month pending reconciliation, a known price, an estimate, or "price unknown"), and
 * the monthly cap with its form (an Admin) or its read-only note (a Director). `unreadable` is spend the Hub could not read: the page says so and shows
 * no figure. No behaviour, so the tests draw the very same markup.
 */
export function SpendBody({ screen, unreadable = false, form }: { screen: SpendScreen | null; unreadable?: boolean; form: ReactNode }) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <h1>{englishText("staff.spend.title")}</h1>
        <p>{englishText("staff.spend.lead")}</p>
      </Stack>
      {screen === null || unreadable ? (
        <p role="alert" className="hub-error" data-testid="spend-unreadable">
          {englishText("staff.spend.errors.unreadable")}
        </p>
      ) : (
        <>
          <section aria-labelledby="spend-budget-heading" data-testid="budget">
            <Stack gap="related">
              <h2 id="spend-budget-heading">{screen.budget.heading}</h2>
              <p className="hub-wrap" data-testid="budget-line">
                {screen.budget.line}
              </p>
              {screen.budget.incomplete ? (
                <p role="note" className="hub-flag hub-wrap" data-testid="budget-incomplete">
                  {screen.budget.incomplete}
                </p>
              ) : null}
            </Stack>
          </section>
          {screen.periods.map((period) => (
            <Period key={period.id} period={period} />
          ))}
          <section aria-labelledby="spend-cap-heading" data-testid="cap">
            <Stack gap="stack">
              <h2 id="spend-cap-heading">{screen.cap.heading}</h2>
              <Stack gap="related">
                <p className="hub-wrap" data-testid="cap-state">
                  {screen.cap.state}
                </p>
                {screen.cap.setOn ? <small data-testid="cap-set-on">{screen.cap.setOn}</small> : null}
                <p className="hub-wrap" data-testid="cap-rule">
                  {screen.cap.rule}
                </p>
              </Stack>
              {form}
            </Stack>
          </section>
        </>
      )}
    </Stack>
  );
}
