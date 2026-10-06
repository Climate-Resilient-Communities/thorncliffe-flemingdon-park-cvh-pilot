import { expect, test, type Page } from "@playwright/test";
import type { RoundState } from "../../src/app/staff/ambassador/round/roundModel";
import { roundScreen } from "../../src/app/staff/ambassador/round/view";
import { COUNTS_ONLY, REF_A, REF_C, ROUND } from "../helpers/ambassador-round";
import { expectNoHorizontalOverflow, hubPage } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand, longestTexts } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { tapViolations } from "../helpers/tap-check";

// S08.07: "My round" (A-04) inside the real Hub shell, on a phone first and used with one hand: one column at every width, no horizontal overflow at 320, 390,
// 699, 700 and 1280 px in `en` and `ur` (the shell's longest labels), every link and button the full tap size (the three marks side by side, equal), and the
// words of each state as the epic names them.
const brand = hubBrand();
const WIDTHS = [320, 390, 699, 700, 1280];

const STATES: { name: string; initial: Partial<RoundState>; role?: "ambassador" | "coordinator" }[] = [
  { name: "an Ambassador's round", initial: { phase: "ready", round: ROUND } },
  { name: "marks waiting without signal", initial: { phase: "ready", round: ROUND, online: false, waiting: [{ id: "0f0e0d0c-0b0a-4908-8706-000000000001", roundRef: REF_A, status: "done" }] } },
  { name: "what late marks are told", initial: { phase: "ready", round: ROUND, notes: { [REF_A]: "hub_told", [REF_C]: "round_ended" } } },
  { name: "the round cleared", initial: { phase: "cleared" } },
  { name: "counts only", initial: { phase: "ready", round: COUNTS_ONLY }, role: "coordinator" },
  { name: "cleared, with what a waiting mark was answered", initial: { phase: "cleared", notes: { [REF_C]: "round_ended" } } },
  { name: "signed out", initial: { phase: "signed_out", waiting: [{ id: "0f0e0d0c-0b0a-4908-8706-000000000001", roundRef: REF_A, status: "needs_help" }] } },
  { name: "the round could not be read", initial: { phase: "failed" } },
];

const open = (page: Page, state: (typeof STATES)[number], lang: "en" | "ur" = "en", longest = false) =>
  mount(page, "AmbassadorRoundFixture", { texts: longest ? longestTexts(lang) : REAL_TEXTS, brand, screen: roundScreen(state.role ?? "ambassador"), initial: state.initial }, { lang });

for (const state of STATES) {
  test.describe(`A-04 ${state.name}`, () => {
    test("has no horizontal overflow at 320, 390, 699, 700 and 1280 px, in en and ur", async ({ page }) => {
      for (const lang of ["en", "ur"] as const) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await open(page, state, lang, true);
          await expectNoHorizontalOverflow(page, hubPage(page));
        }
      }
    });

    test("has every link and button at the tap size at 320, 390 and 1280 px", async ({ page }) => {
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, state);
        expect(await tapViolations(page), `targets below the tap size at ${width}px`).toEqual([]);
      }
    });
  });
}

test.describe("what the round says, with the app's own English words at 390 px", () => {
  test.beforeEach(async ({ page }) => page.setViewportSize({ width: 390, height: 844 }));

  test("gives each request its number as a call or text link and three marks side by side, equal, the current one pressed", async ({ page }) => {
    await open(page, STATES[0]);
    const first = page.locator(`[data-round-ref="${REF_A}"]`);
    await expect(first.getByRole("link", { name: "Call (416) 555-0181" })).toHaveAttribute("href", "tel:+14165550181");
    await expect(page.getByRole("link", { name: "Text (416) 555-0182" })).toHaveAttribute("href", "sms:+14165550182");
    const marks = first.getByRole("group", { name: "What happened with (416) 555-0181" }).getByRole("button");
    await expect(marks).toHaveText(["Done", "Not reached", "Needs help"]);
    const boxes = await marks.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect()));
    expect(new Set(boxes.map((box) => Math.round(box.top))).size, "one row").toBe(1);
    expect(new Set(boxes.map((box) => Math.round(box.width))).size, "equal widths").toBe(1);
    await expect(page.locator(`[data-round-ref="${REF_C}"]`).getByRole("button", { name: "Needs help" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("round-floor-counts")).toContainText("Counts only: you do not cover this floor.");
  });

  test("says how many marks wait and to keep the page open, and what late marks are told", async ({ page }) => {
    await open(page, STATES[1]);
    await expect(page.getByTestId("round-waiting")).toHaveText("1 mark is waiting to be sent. Keep this page open until marks are sent");
    await expect(page.getByTestId("round-offline")).toBeVisible();
    await open(page, STATES[2]);
    await expect(page.locator(`[data-round-ref="${REF_A}"]`).getByTestId("round-note")).toHaveText("The Hub has been told; call the Hub if you can");
    const ended = page.locator(`[data-round-ref="${REF_C}"]`).getByTestId("round-note");
    await expect(ended).toHaveText("This round has ended. If someone needs help, call the Hub at (416) 421-8997");
    await expect(ended.getByRole("link")).toHaveAttribute("href", "tel:+14164218997");
  });

  test("shows nothing of the round once cleared, only how to load it again", async ({ page }) => {
    await open(page, STATES[3]);
    await expect(page.getByTestId("round-cleared")).toContainText("Reload your round with signal");
    await expect(page.getByRole("button", { name: "Reload my round" })).toBeVisible();
    await expect(page.locator("[data-round-ref]")).toHaveCount(0);
  });

  test("says what a waiting mark was answered when its row is not shown, with the Hub's number as a tel: link", async ({ page }) => {
    await open(page, STATES[5]);
    const ended = page.getByTestId("round-note-loose");
    await expect(ended).toHaveText("This round has ended. If someone needs help, call the Hub at (416) 421-8997");
    await expect(ended.getByRole("link")).toHaveAttribute("href", "tel:+14164218997");
    await expect(page.getByTestId("round-cleared")).toContainText("Reload your round with signal");
  });

  test("says when the session ended with marks waiting, and when the round could not be read", async ({ page }) => {
    await open(page, STATES[6]);
    await expect(page.getByTestId("round-signed-out")).toHaveText("You were signed out, so marks are not being sent. Sign in again with signal, then open your round again.");
    await expect(page.getByTestId("round-waiting")).toContainText("1 mark is waiting to be sent.");
    await open(page, STATES[7]);
    await expect(page.getByTestId("round-failed")).toHaveText("Your round could not be loaded. Try again with signal.");
    await expect(page.getByRole("button", { name: "Reload my round" })).toBeVisible();
  });
});
