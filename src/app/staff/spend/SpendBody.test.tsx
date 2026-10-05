import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { englishText } from "@/i18n/text";
import { buildCohereSpend, buildMonthReport, buildOverview, buildPeriod, monthInterval, summariseSms } from "@/modules/spend";
import type { CapState } from "./control";
import { CapFormView, type CapLabels } from "./CapFormView";
import { SpendBody } from "./SpendBody";
import { spendScreen } from "./view";

const t = (key: string) => englishText(`staff.spend.${key}`);
const labels: CapLabels = { label: t("cap.label"), hint: t("cap.hint"), save: t("cap.save"), saving: t("cap.saving") };
const IDLE: CapState = { status: "idle" };

const pending = buildMonthReport({
  interval: monthInterval("2026-10"),
  reconciliation: null,
  actuals: { count: 0, millicents: 0 },
  matched: { count: 0, actualMillicents: 0, estimateCents: 0 },
  unresolved: { count: 12, cents: 36 },
});
const cohere = buildCohereSpend({ calls: 2, tokens: 90_000, tokensEstimated: false, pricedCalls: 0, pricedMicroCad: 0, unpricedCalls: 2, unpricedTokens: 90_000 }, null);
const period = buildPeriod(summariseSms([pending]), cohere);
const screen = spendScreen(buildOverview({ month: "2026-10", thisMonth: period, pilot: period, budgetCents: 100_000, capCents: 5_000 }), { setOn: null });

const form = (answer: CapState = IDLE) => <CapFormView labels={labels} answer={answer} current="50.00" />;
const page = (read = true, answer: CapState = IDLE) =>
  renderToStaticMarkup(<SpendBody screen={read ? screen : null} unreadable={!read} form={read ? form(answer) : null} />);

describe("the Spend page", () => {
  const html = page();

  it("shows the pilot budget, this month and the pilot to date, each with its text message and Cohere figures", () => {
    expect(html).toContain("<h1>Spend</h1>");
    expect(html).toContain("Budget: CAD 1,000.00. Counted so far: CAD 0.36. CAD 999.64 left.");
    expect(html).toContain("This month (October 2026)");
    expect(html).toContain("The pilot to date");
    expect(html.match(/Pending reconciliation, October 2026: CAD 0\.36 estimated for 12 texts/g)).toHaveLength(2);
  });

  it("shows Cohere usage with no price as 'price unknown' with its units, and says the total leaves it out", () => {
    expect(html).toContain("Price unknown: 2 calls, 90,000 tokens");
    expect(html).toContain('data-testid="incomplete-month"');
    expect(html).toContain('data-testid="budget-incomplete"');
  });

  it("shows the cap, that it only warns, and the form with the cap in force filled in", () => {
    expect(html).toContain("The monthly cap is CAD 50.00. 0% of it is used this month.");
    expect(html).toContain("The cap warns and never blocks.");
    expect(html).toMatch(/<input[^>]*id="spend-cap"[^>]*required=""/);
    expect(html).toContain('value="50.00"');
    expect(html).toContain("Save cap");
  });

  it("says the spend could not be read, and shows no figure, when it could not", () => {
    const failed = page(false);
    expect(failed).toContain("The Hub could not read the spend.");
    expect(failed).not.toContain("CAD");
  });
});

describe("the cap form", () => {
  it("tells what a press did in a live region that is always in the page, and a refusal as an alert that says nothing changed", () => {
    expect(renderToStaticMarkup(form())).toContain('aria-live="polite"');
    const done = renderToStaticMarkup(form({ status: "done", at: 1, lines: ["The monthly cap is now CAD 50.00."] }));
    expect(done).toContain("The monthly cap is now CAD 50.00.");
    const refused = renderToStaticMarkup(form({ status: "refused", at: 1, message: "The cap must be at least $0.01." }));
    expect(refused).toContain('role="alert"');
    expect(refused).toContain("The cap must be at least $0.01.");
    expect(refused).toMatch(/aria-describedby="spend-cap-hint spend-cap-error"/);
  });

  it("names its button 'Saving cap' while a press is on its way, and disables it", () => {
    const html = renderToStaticMarkup(<CapFormView labels={labels} answer={IDLE} saving />);
    expect(html).toContain("Saving cap");
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });
});
