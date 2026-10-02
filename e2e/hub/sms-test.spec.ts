import { expect, test, type Page } from "@playwright/test";
import { describeOutcome, describeUnknownAttempts } from "../../src/app/staff/sms-test/sendTest";
import { englishText } from "../../src/i18n/text";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S01.15: the Test text screen in the Hub shell, in en as an Admin sees it: the preview notice, the form ready to send,
// and what a press leaves (Twilio accepted it, a refusal, Twilio's error). The page's real body and form markup render
// with the stand-in states the server action would return; nothing here is a phone number (the options are masked
// labels with opaque values). The behaviour is asserted in src/app/staff/sms-test; these pictures show what it looks like.
const brand = hubBrand();
const HEIGHT = 844;
const NEXT = "01900000-0000-7000-8000-00000000f099";
const SID = `SM${"0123456789abcdef".repeat(2)}`;

const texts = { ...REAL_TEXTS, heading: englishText("staff.smsTest.title"), paragraphs: [englishText("staff.smsTest.lead")] };
const labels = { number: englishText("staff.smsTest.number"), numberHint: englishText("staff.smsTest.numberHint"), submit: englishText("staff.smsTest.submit") };
// Opaque values, as the page makes them; the labels are the masks of two approved numbers.
const numbers = [
  { value: "0123456789abcdef", label: "+1 ••• ••• 0101" },
  { value: "fedcba9876543210", label: "+1 ••• ••• 0102" },
];
const form = (state: Parameters<typeof describeOutcome>[0] | null) => ({
  labels,
  numbers,
  requestId: NEXT,
  state: state === null ? ({ status: "idle" } as const) : describeOutcome(state, NEXT),
});

const STATES = {
  preview: { availability: "preview", form: form(null) },
  ready: { availability: "ready", form: form(null) },
  sent: { availability: "ready", form: form({ kind: "sent", httpStatus: 201, status: "queued", messageId: SID }) },
  refused: { availability: "ready", form: form({ kind: "refused", reason: "duplicate_number" }) },
  "provider-error": {
    availability: "ready",
    form: form({ kind: "provider_error", httpStatus: 400, errorCode: 21211, message: "The 'To' number [number] is not a valid phone number." }),
  },
  unknown: { availability: "ready", form: form(null), unknownAttempts: describeUnknownAttempts([{ id: 12, claimedAt: new Date("2026-10-05T14:03:00Z") }]) },
} as const;

async function open(page: Page, state: keyof typeof STATES, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  await mount(page, "SmsTestFixture", { texts, brand, ...STATES[state] }, { lang: "en" });
}

for (const state of Object.keys(STATES) as (keyof typeof STATES)[]) {
  for (const width of [390, 1280]) {
    test(`test text ${state} at ${width}px`, async ({ page }) => {
      await open(page, state, width);

      // The menu names the page and the screen shows no phone number, only masks.
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Test text");
      const html = await page.content();
      expect(html).not.toMatch(/\+\d{8,}/);
      if (state === "preview") {
        await expect(page.getByText("Texts are only sent from production")).toBeVisible();
        await expect(page.getByRole("button", { name: "Send test text" })).toHaveCount(0);
      } else {
        await expect(page.getByRole("button", { name: "Send test text" })).toBeVisible();
      }
      if (state === "sent") await expect(page.getByRole("heading", { name: "Twilio accepted the test text" })).toBeVisible();
      if (state === "refused") await expect(page.getByRole("alert")).toContainText("last 5 minutes");
      if (state === "provider-error") await expect(page.getByRole("alert")).toContainText("Twilio error 21211");
      if (state === "unknown") await expect(page.getByText("Attempt 12, started 2026-10-05 14:03 UTC: outcome unknown")).toBeVisible();

      await expectBaseline(page, `sms-test-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}
