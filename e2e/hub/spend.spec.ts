import { expect, test, type Page } from "@playwright/test";
import type { CapState } from "../../src/app/staff/spend/control";
import type { CapLabels } from "../../src/app/staff/spend/CapFormView";
import { spendScreen, type SpendScreen } from "../../src/app/staff/spend/view";
import { englishText } from "../../src/i18n/text";
import type { CohereSpend, PeriodSpend, SmsSpendSummary, SpendOverview } from "../../src/modules/spend";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S07.08: the Spend screen in the Hub shell, in en, as an Admin sees it (with the monthly cap form) and as a Director sees it (read-only): the budget, this
// month and the pilot to date with every figure labelled (the actual, an unmatched actual, an unresolved estimate, a month pending reconciliation, Cohere at a
// known price, Cohere as "price unknown" with its units or as a labelled estimate), the cap with what a press leaves (the line it says, a refusal), and spend
// that could not be read. The page's real body and form render with the stand-in states the server action would return; every figure is fictional. The
// behaviour is asserted in src/app/staff/spend, test/db/spendCap.db.test.ts and e2e/staff/spend.spec.ts; these pictures show what it looks like.
const brand = hubBrand();
const HEIGHT = 844;

const t = (key: string) => englishText(`staff.spend.${key}`);
const texts = { ...REAL_TEXTS, heading: t("title"), paragraphs: [t("lead")] };
const labels: CapLabels = { label: t("cap.label"), hint: t("cap.hint"), save: t("cap.save"), saving: t("cap.saving") };
const IDLE: CapState = { status: "idle" };

const sms = (over: Partial<SmsSpendSummary> = {}): SmsSpendSummary => ({
  countedCents: 0,
  actual: { cents: 0, texts: 0 },
  unmatchedActuals: { cents: 0, texts: 0 },
  unresolvedEstimates: { cents: 0, texts: 0 },
  pendingMonths: [],
  mayOverlap: false,
  ...over,
});
const NO_COHERE: CohereSpend = { calls: 0, tokens: 0, tokensEstimated: false, priced: { calls: 0, cents: 0 }, unpriced: { calls: 0, tokens: 0, estimateCents: null, label: "price unknown" } };
const UNKNOWN_COHERE: CohereSpend = { calls: 12, tokens: 1_840_000, tokensEstimated: true, priced: { calls: 0, cents: 0 }, unpriced: { calls: 12, tokens: 1_840_000, estimateCents: null, label: "price unknown" } };
const ESTIMATED_COHERE: CohereSpend = { ...UNKNOWN_COHERE, unpriced: { calls: 12, tokens: 1_840_000, estimateCents: 92, label: "estimate" } };
const PRICED_COHERE: CohereSpend = { calls: 12, tokens: 1_840_000, tokensEstimated: false, priced: { calls: 12, cents: 138 }, unpriced: { calls: 0, tokens: 0, estimateCents: null, label: "price unknown" } };

const period = (summary: SmsSpendSummary, cohere: CohereSpend): PeriodSpend => ({
  sms: summary,
  cohere,
  totalCents: summary.countedCents + cohere.priced.cents + (cohere.unpriced.estimateCents ?? 0),
  incomplete: cohere.unpriced.calls > 0 && cohere.unpriced.estimateCents === null,
});

// October is pending reconciliation (the month has not ended); September is complete, with an unmatched actual and an unresolved estimate beside it.
const OCTOBER = sms({ countedCents: 6_240, pendingMonths: [{ month: "2026-10", reason: "not_run", estimatedCents: 6_240, texts: 416 }] });
const PILOT = sms({
  countedCents: 31_780,
  actual: { cents: 25_321, texts: 1_706 },
  unmatchedActuals: { cents: 2, texts: 1 },
  unresolvedEstimates: { cents: 219, texts: 14 },
  pendingMonths: [{ month: "2026-10", reason: "not_run", estimatedCents: 6_240, texts: 416 }],
  mayOverlap: true,
});

const overview = (cohere: CohereSpend, over: Partial<SpendOverview> = {}): SpendOverview => {
  const thisMonth = period(OCTOBER, cohere);
  const pilot = period(PILOT, cohere);
  return { month: "2026-10", thisMonth, pilot, budgetCents: 100_000, remainingCents: 100_000 - pilot.totalCents, capCents: 25_000, capUsedPercent: Math.floor((OCTOBER.countedCents / 25_000) * 100), ...over };
};

const screenOf = (cohere: CohereSpend, over: Partial<SpendOverview> = {}): SpendScreen => spendScreen(overview(cohere, over), { setOn: new Date("2026-10-02T14:30:00Z") });

const STATES = {
  overview: () => ({ role: "admin" as const, screen: screenOf(UNKNOWN_COHERE), form: { labels, answer: IDLE, current: "250.00" } }),
  "cohere-estimate": () => ({ role: "admin" as const, screen: screenOf(ESTIMATED_COHERE), form: { labels, answer: IDLE, current: "250.00" } }),
  "cohere-priced": () => ({ role: "admin" as const, screen: screenOf(PRICED_COHERE), form: { labels, answer: IDLE, current: "250.00" } }),
  "no-cap": () => ({ role: "admin" as const, screen: screenOf(NO_COHERE, { capCents: null, capUsedPercent: null }), form: { labels, answer: IDLE, current: "" } }),
  "over-budget": () => ({ role: "admin" as const, screen: screenOf(NO_COHERE, { budgetCents: 30_000, remainingCents: 30_000 - 31_780 }), form: { labels, answer: IDLE, current: "250.00" } }),
  saved: () => ({
    role: "admin" as const,
    screen: screenOf(NO_COHERE),
    form: { labels, answer: { status: "done", at: 1, lines: ["The monthly cap changed from CAD 250.00 to CAD 300.00."] } satisfies CapState, current: "300.00" },
  }),
  refused: () => ({
    role: "admin" as const,
    screen: screenOf(NO_COHERE),
    form: { labels, answer: { status: "refused", at: 1, message: "That is not an amount. Use dollars, for example 250 or 250.50." } satisfies CapState, current: "two hundred" },
  }),
  director: () => ({ role: "director" as const, screen: screenOf(UNKNOWN_COHERE), form: { labels, answer: IDLE, current: "" } }),
  unreadable: () => ({ role: "admin" as const, screen: null, unreadable: true, form: { labels, answer: IDLE, current: "" } }),
} as const;

async function open(page: Page, state: keyof typeof STATES, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  await mount(page, "SpendFixture", { texts, brand, ...STATES[state]() }, { lang: "en" });
}

for (const state of Object.keys(STATES) as (keyof typeof STATES)[]) {
  for (const width of [390, 1280]) {
    test(`spend ${state} at ${width}px`, async ({ page }) => {
      await open(page, state, width);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Spend");
      // No page needs a sideways scroll.
      const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);

      if (state === "unreadable") {
        await expect(page.getByTestId("spend-unreadable")).toContainText("could not read the spend");
        await expect(page.getByTestId("budget")).toHaveCount(0);
      } else {
        await expect(page.getByTestId("budget-line")).toContainText(state === "over-budget" ? "Budget: CAD 300.00." : "Budget: CAD 1,000.00.");
        await expect(page.getByTestId("period-month")).toContainText("This month (October 2026)");
        await expect(page.getByTestId("period-pilot")).toContainText("The pilot to date");
        // Every kind of figure is labelled on its own line, and a month not yet reconciled says so.
        await expect(page.getByTestId("sms-pilot").getByTestId("line-unmatched")).toContainText("Unmatched actuals");
        await expect(page.getByTestId("sms-pilot").getByTestId("line-unresolved")).toContainText("Unresolved estimates");
        await expect(page.getByTestId("sms-month").getByTestId("line-pending-2026-10")).toContainText("Pending reconciliation, October 2026");
        await expect(page.getByTestId("overlap-pilot")).toContainText("may count it twice");
      }

      if (state === "overview" || state === "director") {
        await expect(page.getByTestId("cohere-month")).toContainText("Price unknown: 12 calls, 1,840,000 tokens");
        await expect(page.getByTestId("incomplete-month")).toBeVisible();
        await expect(page.getByTestId("budget-incomplete")).toBeVisible();
      }
      if (state === "cohere-estimate") {
        await expect(page.getByTestId("cohere-month")).toContainText("Estimate: CAD 0.92 for 12 calls and 1,840,000 tokens whose price is unknown");
        await expect(page.getByTestId("incomplete-month")).toHaveCount(0);
      }
      if (state === "cohere-priced") await expect(page.getByTestId("cohere-month")).toContainText("At a known price: CAD 1.38 for 12 calls");
      if (state === "no-cap") await expect(page.getByTestId("cap-state")).toContainText("No cap is set.");
      if (state === "over-budget") await expect(page.getByTestId("budget-line")).toContainText("over the budget");
      if (state === "overview") await expect(page.getByTestId("cap-state")).toHaveText("The monthly cap is CAD 250.00. 24% of it is used this month.");

      // An Admin has the form and a button big enough to press; a Director has the note and no form.
      if (state === "director") {
        await expect(page.getByTestId("cap-read-only")).toHaveText("Only an Admin can change the cap.");
        await expect(page.getByRole("button", { name: "Save cap" })).toHaveCount(0);
      } else if (state !== "unreadable") {
        const save = page.getByRole("button", { name: "Save cap" });
        await expect(save).toBeVisible();
        expect((await save.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect((await page.getByLabel("Monthly cap (CAD)").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      if (state === "saved") await expect(page.getByTestId("cap-answer")).toContainText("The monthly cap changed from CAD 250.00 to CAD 300.00.");
      if (state === "refused") await expect(page.getByTestId("cap-error")).toContainText("That is not an amount.");

      await expectBaseline(page, `spend-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}
