import { expect, test, type Page } from "@playwright/test";
import type { OncallState } from "../../src/app/staff/oncall/control";
import type { OncallLabels, OncallRow } from "../../src/app/staff/oncall/OncallFormsView";
import { senderBannerView } from "../../src/app/staff/senderBanner";
import { englishText } from "../../src/i18n/text";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S06.07: the On-call numbers screen in the Hub shell, in en as an Admin sees it: the list with each number masked to its last four digits and a
// Remove button that names it, the add form, an empty list and what it means, what a press leaves (the lines it says, a refusal), a roster that
// could not be read, and the banner "Sending is failing" that every Hub screen carries while the sender is failing. The page's real body and
// controls render with the stand-in states the server actions would return; every number is fictional. The behaviour is asserted in
// src/app/staff/oncall; these pictures show what it looks like.
const brand = hubBrand();
const HEIGHT = 844;
const SINCE = new Date("2026-10-05T18:15:00Z");

const t = (key: string) => englishText(`staff.oncall.${key}`);
const texts = { ...REAL_TEXTS, heading: t("title"), paragraphs: [t("lead")] };
const labels: OncallLabels = {
  listHeading: t("listHeading"),
  empty: t("empty"),
  emptyConsequence: t("emptyConsequence"),
  hidden: t("hidden"),
  addHeading: t("addHeading"),
  label: t("label"),
  labelHint: t("labelHint"),
  number: t("number"),
  numberHint: t("numberHint"),
  add: t("add"),
  adding: t("adding"),
  remove: t("remove"),
  removing: t("removing"),
};
const IDLE: OncallState = { status: "idle" };
const ROWS: OncallRow[] = [
  { id: "01900000-0000-7000-8000-0000000000b1", label: "IT lead", masked: "+1 ••• ••• 0123", removeFor: "Remove IT lead" },
  { id: "01900000-0000-7000-8000-0000000000b2", label: "Priya Sharma, Hub Director weekends", masked: "+1 ••• ••• 0199", removeFor: "Remove Priya Sharma" },
];

const props = (rows: OncallRow[], answer: OncallState = IDLE, extra: { unreadable?: boolean; banner?: boolean } = {}) => ({
  count: rows.length,
  unreadable: extra.unreadable,
  form: { rows, labels, answer },
  banner: extra.banner ? (senderBannerView([{ condition: "queue_stuck", since: SINCE }, { condition: "sender_stalled", since: new Date(SINCE.getTime() + 600_000) }]) ?? undefined) : undefined,
});

const STATES = {
  list: () => props(ROWS),
  empty: () => props([]),
  "added-answer": () => props(ROWS, { status: "done", at: 1, lines: ["Priya Sharma was added. The list now has 2 numbers."] }),
  "removed-answer": () => props([ROWS[0]], { status: "done", at: 1, lines: ["Priya Sharma was removed. The list now has 1 number.", "2 waiting texts to that number were cancelled."] }),
  refused: () => props(ROWS, { status: "refused", at: 1, message: "That number is already on the list." }),
  unreadable: () => props([], IDLE, { unreadable: true }),
  "sender-failing": () => props(ROWS, IDLE, { banner: true }),
} as const;

async function open(page: Page, state: keyof typeof STATES, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  await mount(page, "OncallFixture", { texts, brand, ...STATES[state]() }, { lang: "en" });
}

for (const state of Object.keys(STATES) as (keyof typeof STATES)[]) {
  for (const width of [390, 1280]) {
    test(`on-call numbers ${state} at ${width}px`, async ({ page }) => {
      await open(page, state, width);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("On-call numbers");
      await expect(page.getByTestId("oncall-rule")).toContainText("no alert except a drill can be approved while this list is empty");
      // No page needs a sideways scroll.
      const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
      // The add form is always there, with its button and a target that is large enough to press.
      const add = page.getByRole("button", { name: "Add number" });
      await expect(add).toBeVisible();
      expect((await add.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      if (state === "empty" || state === "unreadable") {
        await expect(page.getByTestId("oncall-list")).toHaveCount(0);
      } else {
        await expect(page.getByTestId("oncall-row")).toHaveCount(state === "removed-answer" ? 1 : 2);
        await expect(page.getByTestId("oncall-list")).toContainText("+1 ••• ••• 0123");
        // Only the last four digits of a number are on the page, and every Remove button names its number's owner and is big enough to press.
        await expect(page.getByTestId("oncall-list")).not.toContainText("416");
        const remove = page.getByRole("button", { name: /^Remove/ }).first();
        expect((await remove.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      if (state === "empty") await expect(page.getByTestId("oncall-empty")).toContainText("No on-call number is set.");
      if (state === "added-answer") await expect(page.getByTestId("oncall-answer")).toContainText("The list now has 2 numbers.");
      if (state === "removed-answer") await expect(page.getByTestId("oncall-answer")).toContainText("2 waiting texts to that number were cancelled.");
      if (state === "refused") await expect(page.getByRole("alert")).toContainText("That number is already on the list.");
      if (state === "unreadable") await expect(page.getByTestId("oncall-unreadable")).toContainText("could not read the on-call numbers");
      if (state === "sender-failing") {
        await expect(page.getByTestId("sender-failing-banner")).toBeVisible();
        await expect(page.getByTestId("sender-failing-banner")).toContainText("Sending is failing");
        await expect(page.getByTestId("sender-failing-banner")).toContainText("Tell IT now.");
      } else {
        await expect(page.getByTestId("sender-failing-banner")).toHaveCount(0);
      }

      await expectBaseline(page, `oncall-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}
