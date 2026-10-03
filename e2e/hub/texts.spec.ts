import { expect, test, type Page } from "@playwright/test";
import { loadPauseBanner } from "../../src/app/staff/pauseBanner";
import type { PauseTextsLabels } from "../../src/app/staff/texts/PauseTextsFormView";
import type { TextsState } from "../../src/app/staff/texts/control";
import { pausedView } from "../../src/app/staff/texts/view";
import { englishText } from "../../src/i18n/text";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S06.06: the Pause texts screen in the Hub shell, in en as an Admin sees it: texts going out with the form to pause them, texts paused with
// who, when and why, what had already gone to the provider, the on-call line and the form to resume, the banner above it, and what a press
// leaves (the lines it says, a refusal) or a switch that could not be read. The page's real body and controls render with the stand-in states
// the server actions would return. The behaviour is asserted in src/app/staff/texts; these pictures show what it looks like.
const brand = hubBrand();
const HEIGHT = 844;
const WHEN = new Date("2026-10-05T18:15:00Z");
const PAUSER = "01900000-0000-7000-8000-0000000000a1";

const texts = { ...REAL_TEXTS, heading: englishText("staff.texts.title"), paragraphs: [englishText("staff.texts.lead")] };
const labels: PauseTextsLabels = {
  reason: englishText("staff.texts.reason"),
  reasonHint: englishText("staff.texts.reasonHint"),
  pause: englishText("staff.texts.pause"),
  pausing: englishText("staff.texts.pausing"),
  resume: englishText("staff.texts.resume"),
  resuming: englishText("staff.texts.resuming"),
  resumeHint: englishText("staff.texts.resumeHint"),
};
const IDLE: TextsState = { status: "idle" };
const status = (handedOffAtPause: number | null) => ({
  paused: true as const,
  pausedBy: PAUSER,
  pausedAt: WHEN,
  reason: "Wrong alert sent to building 12: the power outage notice was meant for building 14.",
  handedOffAtPause,
});

async function pausedProps(handedOffAtPause: number | null, answer: TextsState = IDLE) {
  const banner = await loadPauseBanner({ status: async () => status(handedOffAtPause), nameOf: async () => "Priya Sharma", canResume: true, logError: () => {} });
  if (!banner) throw new Error("no banner");
  return { paused: pausedView(status(handedOffAtPause), "Priya Sharma"), banner, form: { paused: true, labels, reasonMaxLength: 500, answer } };
}

const STATES = {
  running: async () => ({ paused: null, form: { paused: false, labels, reasonMaxLength: 500, answer: IDLE } }),
  paused: () => pausedProps(3),
  "paused-answer": () =>
    pausedProps(1, { status: "done", at: 1, lines: ["Texts are paused.", "12 texts are waiting and will go out when you resume.", "1 text was already handed to the provider and cannot be recalled"] }),
  refused: async () => ({ paused: null, form: { paused: false, labels, reasonMaxLength: 500, answer: { status: "refused", at: 1, message: "Say why you are pausing texts." } as TextsState } }),
  unreadable: async () => ({ paused: null, unreadable: true, form: { paused: false, labels, reasonMaxLength: 500, answer: IDLE } }),
} as const;

async function open(page: Page, state: keyof typeof STATES, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  await mount(page, "TextsFixture", { texts, brand, ...(await STATES[state]()) }, { lang: "en" });
}

for (const state of Object.keys(STATES) as (keyof typeof STATES)[]) {
  for (const width of [390, 1280]) {
    test(`pause texts ${state} at ${width}px`, async ({ page }) => {
      await open(page, state, width);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pause or resume texts");
      // No page needs a sideways scroll.
      const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
      if (state === "running" || state === "refused" || state === "unreadable") {
        await expect(page.getByRole("button", { name: "Pause all texts" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Resume texts" })).toHaveCount(0);
        await expect(page.getByTestId("texts-paused-banner")).toHaveCount(0);
      } else {
        await expect(page.getByRole("button", { name: "Resume texts" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Pause all texts" })).toHaveCount(0);
        await expect(page.getByTestId("texts-paused-banner")).toBeVisible();
        await expect(page.getByTestId("texts-status")).toContainText("Paused by Priya Sharma on Oct 5, 2026, 2:15 p.m.");
        await expect(page.getByTestId("texts-oncall")).toBeVisible();
      }
      if (state === "paused") await expect(page.getByTestId("texts-handed-off")).toHaveText("3 texts were already handed to the provider and cannot be recalled");
      if (state === "paused-answer") await expect(page.getByTestId("texts-answer")).toContainText("12 texts are waiting");
      if (state === "refused") await expect(page.getByRole("alert")).toContainText("Say why you are pausing texts.");
      if (state === "unreadable") await expect(page.getByTestId("texts-unreadable")).toContainText("could not read whether texts are paused");

      await expectBaseline(page, `texts-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}
