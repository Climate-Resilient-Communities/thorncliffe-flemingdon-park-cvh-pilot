import { expect, test, type Page } from "@playwright/test";
import type { OncallState } from "../../src/app/staff/oncall/control";
import type { OncallLabels, OncallRow } from "../../src/app/staff/oncall/OncallFormsView";
import { onDutyView, type OnDutyView } from "../../src/app/staff/oncall/view";
import { healthBannerView } from "../../src/app/staff/healthBannerModel";
import { englishText } from "../../src/i18n/text";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S06.07: the On-call numbers screen in the Hub shell, in en as an Admin sees it: the list with each number masked to its last four digits and a
// Remove button that names it, the add form, an empty list and what it means, what a press leaves (the lines it says, a refusal), a roster that
// could not be read, the banner "Sending is failing" that every Hub screen carries while the sender is failing, and (S09.01) the banner an Admin or
// a Coordinator sees naming every other open condition, with the health check itself stopped. The page's real body and
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

const BEATING = { completedAt: SINCE, fresh: true };
const SENDER_FAILING = healthBannerView({ active: [{ condition: "queue_stuck", since: SINCE }, { condition: "sender_stalled", since: new Date(SINCE.getTime() + 600_000) }], heartbeat: BEATING }, { everything: false });
const OTHERS_FAILING = healthBannerView(
  {
    active: [
      { condition: "job_failed", since: SINCE },
      { condition: "publish_failed", since: SINCE },
      { condition: "transactional_ceiling", since: new Date(SINCE.getTime() + 600_000) },
    ],
    heartbeat: { completedAt: new Date(SINCE.getTime() + 300_000), fresh: false },
  },
  { everything: true },
);

// S08.08: the on-duty Admin for check-ins, an entry of the list linked to an active Admin account with an authenticator, as the page draws it with the app's
// own view function: on duty (the entry marked, the choice set to it), and an entry whose Admin can no longer be on duty (escalations go to every number).
const onDutyLabels = {
  heading: t("onDuty.heading"),
  lead: t("onDuty.lead"),
  badge: t("onDuty.badge"),
  number: t("onDuty.number"),
  account: t("onDuty.account"),
  accountHint: t("onDuty.accountHint"),
  noAccount: t("onDuty.noAccount"),
  noNumber: t("onDuty.noNumber"),
  set: t("onDuty.set"),
  setting: t("onDuty.setting"),
  clear: t("onDuty.clear"),
  clearing: t("onDuty.clearing"),
};
const PRIYA = "01900000-0000-7000-8000-0000000000c1";
const ACCOUNTS = [
  { id: "01900000-0000-7000-8000-0000000000c2", name: "Daniel Okoro" },
  { id: PRIYA, name: "Priya Sharma" },
];
const onDutyOf = (state: "set" | "stale"): OnDutyView =>
  onDutyView({
    entries: ROWS.map((row, index) => ({ id: row.id, label: row.label, onDuty: index === 1, staffId: index === 1 ? PRIYA : null })),
    state,
    accounts: state === "set" ? ACCOUNTS : ACCOUNTS.slice(0, 1),
    onDutyName: "Priya Sharma",
  });

const props = (rows: OncallRow[], answer: OncallState = IDLE, extra: { unreadable?: boolean; banner?: "sender" | "others"; onDuty?: "set" | "stale" } = {}) => ({
  count: rows.length,
  unreadable: extra.unreadable,
  form: extra.onDuty
    ? { rows: rows.map((row, index) => ({ ...row, onDuty: index === 1 })), labels: { ...labels, onDuty: onDutyLabels }, answer, onDuty: onDutyOf(extra.onDuty) }
    : { rows, labels, answer },
  banner: (extra.banner === "sender" ? SENDER_FAILING : extra.banner === "others" ? OTHERS_FAILING : null) ?? undefined,
});

const STATES = {
  list: () => props(ROWS),
  empty: () => props([]),
  "added-answer": () => props(ROWS, { status: "done", at: 1, lines: ["Priya Sharma was added. The list now has 2 numbers."] }),
  "removed-answer": () => props([ROWS[0]], { status: "done", at: 1, lines: ["Priya Sharma was removed. The list now has 1 number.", "2 waiting texts to that number were cancelled."] }),
  refused: () => props(ROWS, { status: "refused", at: 1, message: "That number is already on the list." }),
  unreadable: () => props([], IDLE, { unreadable: true }),
  "sender-failing": () => props(ROWS, IDLE, { banner: "sender" }),
  "health-failing": () => props(ROWS, IDLE, { banner: "others" }),
  "on-duty": () => props(ROWS, { status: "done", at: 1, lines: ["Priya Sharma, Hub Director weekends is now on duty."] }, { onDuty: "set" }),
  "on-duty-stale": () => props(ROWS, IDLE, { onDuty: "stale" }),
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
        await expect(page.getByTestId("health-banner")).toBeVisible();
        await expect(page.getByTestId("health-banner")).toContainText("Sending is failing");
        await expect(page.getByTestId("health-banner")).toContainText("Tell IT now.");
      } else if (state === "health-failing") {
        await expect(page.getByTestId("health-banner")).toContainText("Something is not working");
        await expect(page.getByTestId("health-banner")).toContainText("The last directory publish failed.");
        await expect(page.getByTestId("health-banner")).toContainText("The health check has not run for more than 3 minutes");
      } else {
        await expect(page.getByTestId("health-banner")).toHaveCount(0);
      }
      if (state === "on-duty") {
        await expect(page.getByTestId("oncall-on-duty-state")).toHaveText("On duty: Priya Sharma, Hub Director weekends, Priya Sharma's account.");
        await expect(page.getByTestId("oncall-row-on-duty")).toHaveCount(1);
        await expect(page.getByLabel("Admin account")).toHaveValue(PRIYA);
        const set = page.getByRole("button", { name: "Set on duty" });
        expect((await set.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await expect(page.getByRole("button", { name: "Nobody on duty" })).toBeVisible();
      } else if (state === "on-duty-stale") {
        await expect(page.getByTestId("oncall-on-duty-state")).toContainText("is no longer an active Admin with an authenticator");
      } else {
        await expect(page.getByTestId("oncall-on-duty")).toHaveCount(0);
      }

      await expectBaseline(page, `oncall-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}
