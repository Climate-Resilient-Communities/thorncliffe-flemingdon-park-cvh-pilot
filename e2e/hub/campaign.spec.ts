import { expect, test, type Page } from "@playwright/test";
import type { CampaignFormLabels } from "../../src/app/staff/campaign/CampaignFormsView";
import type { CampaignState } from "../../src/app/staff/campaign/control";
import { campaignPageText, campaignScreen, type ScreenInput } from "../../src/app/staff/campaign/view";
import { englishText } from "../../src/i18n/text";
import type { CampaignOverview, CampaignSummary } from "../../src/modules/subscriptions";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S09.07: the End of the pilot screen in the Hub shell, in en as an Admin sees it: before a rehearsal (the start says what it would do and asks for a rehearsal
// first), after one (its texts' outcome, the confirmation with the deadline, the subscribers per language, the cost, the cap's sentence and the box to tick), with
// an empty roster and nobody to ask, while the campaign runs (with the answer of the press that started it), after the deadline (who stayed, and the button that
// reopens sign-ups), once sign-ups are reopened, a refusal, and a campaign that could not be read. The page's real body and forms render with the stand-in states
// the server actions would return; every number is fictional. The behaviour is asserted in src/app/staff/campaign and test/db/campaign.db.test.ts; these pictures
// show what it looks like.
const brand = hubBrand();
const HEIGHT = 844;
const ADMIN = "01900000-0000-7000-8000-0000000000a1";
const OTHER = "01900000-0000-7000-8000-0000000000a2";
const NAMES = new Map([
  [ADMIN, "Ann Okafor"],
  [OTHER, "Priya Sharma"],
]);
const ZERO = { waiting: 0, handedOff: 0, delivered: 0, notDelivered: 0, unknown: 0 };

const t = (key: string) => englishText(`staff.campaign.${key}`);
const texts = { ...REAL_TEXTS, heading: t("title"), paragraphs: [t("lead")] };
const labels: CampaignFormLabels = {
  rehearse: t("rehearsal.button"),
  rehearsing: t("rehearsal.sending"),
  confirm: t("start.confirm"),
  start: t("start.button"),
  starting: t("start.starting"),
  reopen: t("signups.button"),
  reopening: t("signups.reopening"),
};
const IDLE: CampaignState = { status: "idle" };

const summary = (over: Partial<CampaignSummary> = {}): CampaignSummary => ({
  id: "01900000-0000-7000-8000-0000000000c1",
  deadlineDate: "2026-12-05",
  state: "started",
  startedBy: ADMIN,
  startedAt: new Date("2026-11-05T15:00:00Z"),
  endedAt: null,
  signupsReopenedAt: null,
  signupsReopenedBy: null,
  ...over,
});

const ENGLISH = "The CVH pilot is ending. Reply YES to keep getting alerts. If you do not reply by December 5, your number will be deleted.";
const overview = (over: Partial<CampaignOverview> = {}): CampaignOverview => ({
  deadlineDate: "2026-12-05",
  texts: { en: { body: ENGLISH, segments: 1 } } as CampaignOverview["texts"],
  estimate: {
    byLanguage: [
      { lang: "ur", subscribers: 41, costCents: 62 },
      { lang: "bn", subscribers: 17, costCents: 26 },
      { lang: "tl", subscribers: 9, costCents: 14 },
      { lang: "zh", subscribers: 6, costCents: 9 },
      { lang: "en", subscribers: 88, costCents: 132 },
    ],
    subscribers: 161,
    costCents: 243,
  },
  rosterSize: 3,
  rehearsal: null,
  campaign: null,
  signupsClosed: false,
  counts: { asked: 0, kept: 0, active: 161, lapsed: 0 },
  termsVersion: "2026-11-02.2",
  ...over,
});
const REHEARSED = { rehearsal: summary({ id: "r1", startedBy: OTHER, startedAt: new Date("2026-11-04T19:30:00Z") }) };
const CAP =
  "With this campaign, text spending this month would be about $252.43 CAD, which is $2.43 CAD over the monthly cap of $250.00 CAD. You can still start it: the texts are sent, the overrun is recorded and the on-call Admins are told.";

const screenOf = (over: Partial<ScreenInput>) => campaignScreen({ overview: overview(), names: NAMES, rehearsalTexts: null, campaignTexts: null, capNotice: null, ...over });

const STATES = {
  "not-rehearsed": () => ({ screen: screenOf({}), answer: IDLE }),
  rehearsed: () => ({
    screen: screenOf({ overview: overview(REHEARSED), rehearsalTexts: { ...ZERO, handedOff: 3, delivered: 2, unknown: 1 }, capNotice: CAP }),
    answer: { status: "done", at: 1, lines: ["The rehearsal text is queued for 3 staff phones."] } as CampaignState,
  }),
  empty: () => ({ screen: screenOf({ overview: overview({ ...REHEARSED, rosterSize: 0, estimate: { byLanguage: [], subscribers: 0, costCents: 0 } }) }), answer: IDLE }),
  running: () => ({
    screen: screenOf({ overview: overview({ ...REHEARSED, campaign: summary(), signupsClosed: true, counts: { asked: 120, kept: 41, active: 0, lapsed: 0 } }), campaignTexts: { ...ZERO, waiting: 2, handedOff: 159, delivered: 152, notDelivered: 4, unknown: 1 } }),
    answer: { status: "done", at: 1, lines: ["The campaign has started: 161 subscribers are asked, 161 texts are queued and 4 pending sign-ups were deleted. Sign-ups are paused."] } as CampaignState,
  }),
  ended: () => ({
    screen: screenOf({ overview: overview({ ...REHEARSED, campaign: summary({ state: "ended", endedAt: new Date("2026-12-06T05:15:00Z") }), signupsClosed: true, counts: { asked: 0, kept: 41, active: 0, lapsed: 79 } }) }),
    answer: IDLE,
  }),
  reopened: () => ({
    screen: screenOf({
      overview: overview({ ...REHEARSED, campaign: summary({ state: "ended", endedAt: new Date("2026-12-06T05:15:00Z"), signupsReopenedAt: new Date("2026-12-08T14:00:00Z"), signupsReopenedBy: ADMIN }), counts: { asked: 0, kept: 41, active: 0, lapsed: 0 } }),
    }),
    answer: { status: "done", at: 1, lines: ["Sign-ups are open again."] } as CampaignState,
  }),
  refused: () => ({
    screen: screenOf({ overview: overview(REHEARSED) }),
    answer: { status: "refused", at: 1, message: "The deadline has changed since this page was opened: it is now Sunday, December 6, 2026. Check it, then start again." } as CampaignState,
  }),
  unreadable: () => ({ screen: null, unreadable: true, answer: IDLE }),
} as const;

async function open(page: Page, state: keyof typeof STATES, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  await mount(page, "CampaignFixture", { texts, brand, text: campaignPageText(), labels, ...STATES[state]() }, { lang: "en" });
}

for (const state of Object.keys(STATES) as (keyof typeof STATES)[]) {
  for (const width of [390, 1280]) {
    test(`campaign ${state} at ${width}px`, async ({ page }) => {
      await open(page, state, width);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("End of the pilot");
      // The written procedure (S09.03), under the lead in every state.
      await expect(page.getByTestId("procedure-link")).toHaveAttribute("data-procedure", "end-of-pilot");
      // No page needs a sideways scroll.
      const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);

      const start = page.getByRole("button", { name: "Start the campaign" });
      const rehearse = page.getByRole("button", { name: "Rehearse on the drill roster" });
      const reopen = page.getByRole("button", { name: "Reopen sign-ups for the MVP" });
      if (state === "unreadable") {
        await expect(page.getByTestId("campaign-unreadable")).toContainText("could not read the campaign");
        await expect(rehearse).toHaveCount(0);
      }
      if (state === "not-rehearsed") {
        await expect(rehearse).toBeVisible();
        await expect(page.getByTestId("campaign-needs-rehearsal")).toBeVisible();
        await expect(start).toHaveCount(0);
        await expect(page.getByTestId("campaign-deadline")).toHaveText("Deadline: Saturday, December 5, 2026, end of day in Toronto.");
      }
      if (state === "rehearsed" || state === "refused") {
        await expect(start).toBeVisible();
        expect((await start.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await expect(page.getByRole("checkbox", { name: /I have checked the rehearsal/ })).toBeVisible();
        await expect(page.getByTestId("campaign-asked")).toHaveText("Subscribers who will be asked: 161");
        await expect(page.getByTestId("campaign-cost")).toHaveText("Estimated cost: $2.43 CAD for 161 texts.");
        await expect(page.getByTestId("campaign-text")).toHaveText(ENGLISH);
      }
      if (state === "rehearsed") {
        await expect(page.getByTestId("campaign-last-rehearsal")).toContainText("by Priya Sharma");
        await expect(page.getByTestId("campaign-cap")).toContainText("over the monthly cap");
        await expect(page.getByTestId("campaign-answer")).toContainText("queued for 3 staff phones");
      }
      if (state === "empty") {
        await expect(page.getByTestId("campaign-rehearsal")).toContainText("The drill roster is empty");
        await expect(rehearse).toHaveCount(0);
      }
      if (state === "running") {
        await expect(page.getByTestId("campaign-running")).toContainText("Asked and not yet replied: 120");
        await expect(page.getByTestId("campaign-signups")).toContainText("Sign-ups are paused while the pilot ends");
        await expect(rehearse).toHaveCount(0);
        await expect(start).toHaveCount(0);
        await expect(reopen).toHaveCount(0);
      }
      if (state === "ended") {
        await expect(page.getByTestId("campaign-ended")).toContainText("Did not reply, to be deleted: 79");
        await expect(reopen).toBeVisible();
      }
      if (state === "reopened") {
        await expect(page.getByTestId("campaign-signups")).toContainText("Sign-ups were reopened");
        await expect(reopen).toHaveCount(0);
      }
      if (state === "refused") await expect(page.getByTestId("campaign-error")).toContainText("The deadline has changed");

      await expectBaseline(page, `campaign-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}
