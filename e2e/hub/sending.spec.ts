import { expect, test, type Page } from "@playwright/test";
import { approvalScreen } from "../../src/app/staff/alerts/approval/view";
import type { ProblemListScreen, SendingScreen } from "../../src/app/staff/alerts/sending/load";
import { problemListView, sendingProgressView } from "../../src/app/staff/alerts/sending/view";
import type { ResendState } from "../../src/app/staff/alerts/sending/texts/control";
import { progressOf, type ProblemText } from "../../src/modules/messaging";
import { APPROVER, PLANS, reviewOf } from "../../test/helpers/approvalReview";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S06.09: the sending progress of an alert in the Hub shell, in en as a Coordinator sees it: the counts per language while texts go out, while texts are paused (the
// sentence about the texts already handed to the provider), once everything has an answer (with the links to the lists of the texts that did not arrive), with
// skipped texts, for an alert with no text, for a practice alert and for a progress that could not be read; and the lists of the failed texts and of the texts with an
// unknown outcome, each with what it means in plain words and no phone number. The pages' real bodies render from view models built here; the behaviour is
// asserted in src/app/staff/alerts/sending and test/db/sendingProgress.db.test.ts, and these pictures show what it looks like. S09.02 adds the Admin's lists: "Resend" on each text
// that can be resent, a note on the ones that cannot, the warning and the box to tick on a text with an unknown outcome, "Resend the failed and undelivered texts in {language}"
// for each language, and the answers a press leaves (done, and refused with nothing resent).
const brand = hubBrand();
const HEIGHT = 844;
const REF = { alertId: "01900000-0000-7000-8000-00000000a1e7", entryId: "01900000-0000-7000-8000-00000000e177" };
const HEADING = "Elevator, Power · Acknowledgement";
const BACK = { href: "/staff/alerts/approve?alert=a&entry=e", label: "Back to the alert" };

type Row = Parameters<typeof progressOf>[0][number];
const rows = (lang: string, state: Row["state"], n: number, handedOff = false): Row[] => Array.from({ length: n }, () => ({ lang, state, handedOff }));

const GOING_OUT = progressOf([
  ...rows("en", "delivered", 412, true),
  ...rows("en", "submitted", 38, true),
  ...rows("en", "queued", 120),
  ...rows("ur", "delivered", 233, true),
  ...rows("ur", "claimed", 4, true),
  ...rows("ur", "queued", 61),
  ...rows("zh-Hant", "delivered", 12, true),
  ...rows("zh-Hant", "undelivered", 2, true),
  ...rows("zh-Hant", "failed", 1),
  ...rows("hi", "queued", 9),
  ...rows("prs", "unknown", 1, true),
]);
const FINISHED = progressOf([...rows("en", "delivered", 640, true), ...rows("ur", "delivered", 301, true), ...rows("ur", "undelivered", 7, true), ...rows("ur", "failed", 3), ...rows("zh-Hant", "unknown", 2, true), ...rows("en", "cancelled", 4)]);
const SKIPPED = progressOf([...rows("en", "delivered", 20, true), ...rows("en", "skipped", 3), ...rows("ur", "skipped_env", 5), ...rows("ur", "cancelled", 2)]);

const screen = (patch: Partial<SendingScreen>): SendingScreen => ({ kind: "screen", ref: REF, heading: HEADING, block: null, notice: null, back: BACK, ...patch });
const block = (progress: Parameters<typeof sendingProgressView>[0]["progress"], paused = false) => ({ kind: "progress" as const, view: sendingProgressView({ ref: REF, progress, paused }) });

const STATES: Record<string, SendingScreen> = {
  "going-out": screen({ block: block(GOING_OUT) }),
  paused: screen({ block: block(GOING_OUT, true) }),
  finished: screen({ block: block(FINISHED) }),
  skipped: screen({ block: block(SKIPPED) }),
  none: screen({ block: block(progressOf([])) }),
  drill: screen({ notice: { message: "This is a practice alert. What became of its texts is on the Drills page, apart from real alerts.", link: { href: "/staff/drills", label: "Open the Drills page" } } }),
  unavailable: screen({ block: { kind: "unavailable", note: "The sending progress could not be read just now. Reload the page. If this stays, tell IT." } }),
};

const at = new Date("2026-10-05T18:15:00Z");
const text = (n: number, over: Partial<ProblemText>): ProblemText => ({ id: `01900000-0000-7000-8000-0000000abc${String(n).padStart(2, "0")}`, reference: `0abc${String(n).padStart(2, "0")}`, lang: "ur", state: "failed", meaning: "not_in_service", code: null, at, resendN: null, resends: 0, resent: false, ...over });
const list = (state: ProblemText["state"], texts: ProblemText[], more = false): ProblemListScreen => ({
  kind: "list",
  ref: REF,
  heading: HEADING,
  list: problemListView({ ref: REF, state, texts, more, limit: 200 }),
});
const LISTS: Record<string, ProblemListScreen> = {
  "list-failed": list("failed", [
    text(1, { meaning: "not_in_service" }),
    text(2, { lang: "zh-Hant", meaning: "landline" }),
    text(3, { lang: "en", meaning: "sender_not_ready" }),
    text(4, { lang: "hi", meaning: "other_code", code: 31999 }),
    text(5, { lang: "prs", meaning: "retries_exhausted" }),
  ]),
  "list-unknown": list("unknown", [text(6, { state: "unknown", meaning: "unclear", lang: "zh-Hant" }), text(7, { state: "unknown", meaning: "unclear", lang: "prs" })], true),
  "list-empty": list("undelivered", []),
};

const ADMIN_LISTS: Record<string, { screen: ProblemListScreen; answer?: ResendState }> = {
  "admin-failed": {
    screen: {
      kind: "list",
      ref: REF,
      heading: HEADING,
      list: problemListView({
        ref: REF,
        state: "failed",
        texts: [
          text(1, { meaning: "no_reason" }),
          text(2, { lang: "zh-Hant", meaning: "retries_exhausted" }),
          text(3, { lang: "en", meaning: "sender_not_ready", resendN: 1, resends: 1 }),
          text(4, { lang: "hi", meaning: "invalid_number" }),
          text(5, { lang: "prs", meaning: "no_reason", resent: true, resends: 1 }),
          text(6, { lang: "ur", meaning: "no_reason", resendN: 2, resends: 2 }),
        ],
        more: false,
        limit: 200,
        canResend: true,
        resendLanguages: ["en", "ur", "zh-Hant"],
      }),
    },
  },
  "admin-unknown": {
    screen: {
      kind: "list",
      ref: REF,
      heading: HEADING,
      list: problemListView({
        ref: REF,
        state: "unknown",
        texts: [text(7, { state: "unknown", meaning: "unclear", lang: "zh-Hant" }), text(8, { state: "unknown", meaning: "unclear", lang: "prs" })],
        more: false,
        limit: 200,
        canResend: true,
      }),
    },
  },
  "admin-failed-refused": {
    screen: {
      kind: "list",
      ref: REF,
      heading: HEADING,
      list: problemListView({ ref: REF, state: "failed", texts: [text(9, { meaning: "no_reason" })], more: false, limit: 200, canResend: true, resendLanguages: ["ur"] }),
    },
    answer: { status: "refused", message: "This text has already been resent twice, which is the most. Nothing was resent.", at: 1 },
  },
  "admin-failed-done": {
    screen: {
      kind: "list",
      ref: REF,
      heading: HEADING,
      list: problemListView({ ref: REF, state: "failed", texts: [text(10, { meaning: "no_reason" })], more: false, limit: 200, canResend: true, resendLanguages: ["ur"] }),
    },
    answer: { status: "done", lines: ["3 texts were resent. They are in the queue and go out in their usual order.", "1 left out: 1 the number cannot receive texts."], at: 1 },
  },
};

async function fit(page: Page, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
}

const noScroll = async (page: Page) => {
  const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
};

const tapTargetsAre44 = async (page: Page, selector: string) => {
  for (const link of await page.locator(selector).all()) {
    const box = await link.boundingBox();
    expect(box?.height ?? 0, await link.innerText()).toBeGreaterThanOrEqual(44);
  }
};

for (const state of Object.keys(STATES)) {
  for (const width of [390, 1280]) {
    test(`sending progress ${state} at ${width}px`, async ({ page }) => {
      await fit(page, width);
      await mount(page, "SendingFixture", { texts: REAL_TEXTS, brand, screen: STATES[state] }, { lang: "en" });

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADING);
      await noScroll(page);
      if (state === "going-out" || state === "paused" || state === "finished" || state === "skipped") {
        await expect(page.getByTestId("sending")).toBeVisible();
        await expect(page.getByTestId("sending-en").locator('[data-count="waiting"]')).toBeVisible();
        for (const id of ["waiting", "inFlight", "delivered", "undelivered", "failed", "unknown", "cancelled"]) await expect(page.getByTestId("sending-en").locator(`[data-count="${id}"]`)).toHaveCount(1);
      }
      if (state === "going-out") {
        await expect(page.getByTestId("sending-en").locator('[data-count="inFlight"]')).toHaveText("In flight: 38");
        await expect(page.getByTestId("sending-ur").locator('[data-count="inFlight"]')).toHaveText("In flight: 4");
        await expect(page.getByTestId("sending")).toHaveAttribute("data-live", "true");
        await expect(page.getByTestId("sending-handed-off")).toHaveCount(0);
        await expect(page.getByTestId("sending-all")).toBeVisible();
      }
      if (state === "paused") await expect(page.getByTestId("sending-handed-off")).toHaveText("702 texts were already handed to the provider and cannot be recalled");
      if (state === "finished") {
        await expect(page.getByTestId("sending")).toHaveAttribute("data-live", "false");
        await expect(page.getByTestId("sending-list-failed")).toHaveText("See the failed texts (3)");
        await expect(page.getByTestId("sending-list-undelivered")).toBeVisible();
        await expect(page.getByTestId("sending-list-unknown")).toBeVisible();
        await tapTargetsAre44(page, '[data-testid^="sending-list-"]');
      }
      if (state === "skipped") await expect(page.getByTestId("sending-en").locator('[data-count="skipped"]')).toHaveText("Skipped: 3");
      if (state === "none") await expect(page.getByTestId("sending-none")).toBeVisible();
      if (state === "drill") {
        await expect(page.getByTestId("sending")).toHaveCount(0);
        await expect(page.getByTestId("sending-notice-link")).toHaveAttribute("href", "/staff/drills");
      }
      if (state === "unavailable") await expect(page.getByTestId("sending-unavailable")).toBeVisible();
      await tapTargetsAre44(page, '[data-testid="sending-back"]');

      await expectBaseline(page, `sending-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}

for (const state of Object.keys(LISTS)) {
  for (const width of [390, 1280]) {
    test(`sending texts ${state} at ${width}px`, async ({ page }) => {
      await fit(page, width);
      await mount(page, "SendingFixture", { texts: REAL_TEXTS, brand, list: LISTS[state] }, { lang: "en" });

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(state === "list-failed" ? "Failed texts" : state === "list-unknown" ? "Texts with an unknown outcome" : "Undelivered texts");
      await noScroll(page);
      if (state === "list-failed") {
        await expect(page.getByTestId("sending-list-item")).toHaveCount(5);
        await expect(page.getByTestId("sending-list-items")).toContainText("Number not in service");
        await expect(page.getByTestId("sending-list-items")).toContainText("The provider reported error 31999");
      }
      if (state === "list-unknown") {
        await expect(page.getByTestId("sending-list-items")).toContainText("Outcome unclear; not re-sent");
        await expect(page.getByText("Only the 200 most recent texts are shown.")).toBeVisible();
      }
      if (state === "list-empty") await expect(page.getByTestId("sending-list-none")).toBeVisible();
      // No phone number is on the screen.
      expect(await page.locator("main, [data-testid='screen']").first().innerText()).not.toMatch(/\+\d|\d{3}[ -]\d{3}[ -]\d{4}/);
      await tapTargetsAre44(page, '[data-testid="sending-list-back"]');

      await expectBaseline(page, `sending-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}

for (const state of Object.keys(ADMIN_LISTS)) {
  for (const width of [390, 1280]) {
    test(`sending texts for an Admin, ${state} at ${width}px`, async ({ page }) => {
      await fit(page, width);
      const { screen, answer } = ADMIN_LISTS[state];
      await mount(page, "SendingFixture", { texts: REAL_TEXTS, brand, list: screen, resend: { answer } }, { lang: "en" });

      await expect(page.getByTestId("resend-intro")).toBeVisible();
      await noScroll(page);
      if (state === "admin-failed") {
        // A Resend on the four texts that can be resent, a note on the other two and on the resent ones, and a button for each language with something to resend.
        await expect(page.getByTestId("resend-one")).toHaveCount(3);
        await expect(page.getByTestId("sending-list-note")).toHaveCount(4);
        await expect(page.getByTestId("resend-all-en")).toBeVisible();
        await expect(page.getByTestId("resend-all-ur")).toBeVisible();
        await expect(page.getByTestId("resend-all-zh-Hant")).toBeVisible();
        await expect(page.getByRole("button", { name: "Resend text 0abc01" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Resend the failed and undelivered texts in English" })).toBeVisible();
      }
      if (state === "admin-unknown") {
        await expect(page.getByTestId("resend-one")).toHaveCount(2);
        await expect(page.getByTestId("resend-all-en")).toHaveCount(0);
        await expect(page.getByLabel("This text may already have arrived; resending may send it twice")).toHaveCount(2);
        await expect(page.getByLabel("This text may already have arrived; resending may send it twice").first()).not.toBeChecked();
      }
      if (state === "admin-failed-refused") await expect(page.getByTestId("resend-error").first()).toHaveText(/Nothing was resent/);
      if (state === "admin-failed-done") await expect(page.getByTestId("resend-answer").first()).toContainText("3 texts were resent");
      await tapTargetsAre44(page, '[data-testid="sending-list-back"], [data-testid="resend-one"] button, [data-testid^="resend-all-"] button');
      expect(await page.locator("main, [data-testid='screen']").first().innerText()).not.toMatch(/\+\d|\d{3}[ -]\d{3}[ -]\d{4}/);

      await expectBaseline(page, `sending-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}

// The published confirmation (O-06) with the progress in its main column, while texts are paused (the sentence about the texts already handed to the provider).
for (const width of [390, 1280]) {
  test(`the published confirmation shows the sending progress, at ${width}px`, async ({ page }) => {
    await fit(page, width);
    const screen = approvalScreen({
      review: reviewOf({ entry: { status: "approved" } as never }),
      plans: PLANS,
      pricePerSegmentCents: 1.5,
      viewerId: APPROVER,
      sending: block(GOING_OUT, true),
    });
    await mount(page, "ApprovalFixture", { texts: REAL_TEXTS, brand, screen }, { lang: "en" });

    await expect(page.getByTestId("published-title")).toHaveText("The acknowledgement is out");
    await expect(page.getByTestId("sending")).toBeVisible();
    await expect(page.getByTestId("sending-handed-off")).toHaveText("702 texts were already handed to the provider and cannot be recalled");
    await expect(page.getByTestId("next-sending")).toHaveText("See sending progress");
    await noScroll(page);
    await tapTargetsAre44(page, '[data-testid^="sending-list-"], [data-testid="next-sending"]');

    await expectBaseline(page, `sending-en-published-${width}.png`, { fullPage: true });
  });
}
