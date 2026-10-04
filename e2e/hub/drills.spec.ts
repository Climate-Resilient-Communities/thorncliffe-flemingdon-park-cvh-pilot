import { expect, test, type Page } from "@playwright/test";
import { composerScreen } from "../../src/app/staff/alerts/composer/view";
import { logScreen } from "../../src/app/staff/alerts/log/view";
import { drillView, drillsView } from "../../src/app/staff/drills/view";
import type { RosterState } from "../../src/app/staff/drills/roster/control";
import type { RosterLabels, RosterRow } from "../../src/app/staff/drills/roster/RosterFormsView";
import { languageChoices } from "../../src/app/staff/drills/roster/view";
import type { DrillThreadSummary, EntryState } from "../../src/modules/alerting";
import type { DrillResultRow } from "../../src/modules/messaging";
import type { BuildingFloorPlan } from "../../src/modules/places";
import { englishText } from "../../src/i18n/text";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S06.05: the Drills screen, the drill roster screen and "Start a drill" in the Hub shell, in en as an Admin sees them: the Drills page with a drill
// (the five counts per roster member and language, an unknown text flagged, a removed member), without one, and with an empty roster; the roster with
// each phone masked to its last four digits, an Edit and a Remove that name it, the add form, an empty roster, what a press leaves and a roster that
// could not be read; the start of a drill with the exercise marker; and a drill's composer with the marker above it. The pages' real bodies and controls
// render with the stand-in states the server actions would return; every number is fictional. The behaviour is asserted in src/app/staff/drills,
// test/db/drills.db.test.ts and e2e/staff/drills.spec.ts; these pictures show what it looks like.
const brand = hubBrand();
const HEIGHT = 844;
const NOW = new Date("2026-10-05T14:00:00Z");

const A = "01900000-0000-7000-8000-0000000000b1";
const B = "01900000-0000-7000-8000-0000000000b2";
const LABELS = new Map([
  [A, "Hub phone"],
  [B, "Priya Sharma, Hub Director weekends"],
]);

const thread: DrillThreadSummary = {
  id: "01900000-0000-7000-8000-0000000000c1",
  reportedAt: new Date("2026-10-05T13:30:00Z"),
  status: "open",
  closedReason: null,
  types: ["power"],
  entries: [
    { id: "e1", kind: "ack", status: "approved", approvedAt: new Date("2026-10-05T13:40:00Z") },
    { id: "e2", kind: "update", status: "approved", approvedAt: new Date("2026-10-05T13:50:00Z") },
    { id: "e3", kind: "correction", status: "pending_approval", approvedAt: null },
  ],
};
const result = (over: Partial<DrillResultRow>): DrillResultRow => ({ entryId: "e1", recipientId: A, lang: "en", waiting: 0, handedOff: 0, delivered: 0, undelivered: 0, failed: 0, unknown: 0, notSent: 0, ...over });
const RESULTS: DrillResultRow[] = [
  result({ recipientId: A, lang: "en", handedOff: 1, delivered: 1 }),
  result({ entryId: "e2", recipientId: A, lang: "en", handedOff: 2, delivered: 2 }),
  result({ recipientId: B, lang: "ur", handedOff: 3, delivered: 1, undelivered: 1, unknown: 1 }),
  result({ recipientId: null, lang: "en", handedOff: 0, notSent: 2, failed: 1 }),
  result({ recipientId: B, lang: "hi", waiting: 1 }),
];

const t = (key: string) => englishText(`staff.drillRoster.${key}`);
const labels: RosterLabels = {
  listHeading: t("listHeading"),
  empty: t("empty"),
  emptyConsequence: t("emptyConsequence"),
  hidden: t("hidden"),
  addHeading: t("addHeading"),
  label: t("label"),
  labelHint: t("labelHint"),
  number: t("number"),
  numberHint: t("numberHint"),
  language: t("language"),
  add: t("add"),
  adding: t("adding"),
  edit: t("edit"),
  editNumberHint: t("editNumberHint"),
  save: t("save"),
  saving: t("saving"),
  remove: t("remove"),
  removing: t("removing"),
};
const IDLE: RosterState = { status: "idle" };
const ROWS: RosterRow[] = [
  { id: A, label: "Hub phone", masked: "+1 ••• ••• 0123", lang: "en", languageLine: "Drill text in English", editFor: "Edit Hub phone", removeFor: "Remove Hub phone" },
  { id: B, label: "Priya Sharma, Hub Director weekends", masked: "+1 ••• ••• 0199", lang: "ur", languageLine: "Drill text in Urdu", editFor: "Edit Priya Sharma", removeFor: "Remove Priya Sharma" },
];
const rosterProps = (rows: RosterRow[], answer: RosterState = IDLE, unreadable = false) => ({
  count: rows.length,
  unreadable,
  form: { rows, languages: languageChoices(), labels, answer },
});

const ROSTER_STATES = {
  list: () => rosterProps(ROWS),
  empty: () => rosterProps([]),
  "added-answer": () => rosterProps(ROWS, { status: "done", at: 1, lines: ["Priya Sharma was added. The roster now has 2 phones."] }),
  "removed-answer": () => rosterProps([ROWS[0]], { status: "done", at: 1, lines: ["Priya Sharma was removed. The roster now has 1 phone.", "2 waiting drill texts to that phone were cancelled."] }),
  refused: () => rosterProps(ROWS, { status: "refused", at: 1, message: "That number is already on the roster." }),
  unreadable: () => rosterProps([], IDLE, true),
} as const;

const DRILLS_STATES = {
  "with-a-drill": () => drillsView({ rosterSize: 2, drills: [drillView(thread, RESULTS, LABELS)] }),
  "no-drill": () => drillsView({ rosterSize: 2, drills: [] }),
  "empty-roster": () => drillsView({ rosterSize: 0, drills: [drillView({ ...thread, entries: thread.entries.slice(0, 1) }, [], LABELS)] }),
} as const;

async function fit(page: Page, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height: Math.max(HEIGHT, height) });
}

const noScroll = async (page: Page) => {
  const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
};

for (const state of Object.keys(DRILLS_STATES) as (keyof typeof DRILLS_STATES)[]) {
  for (const width of [390, 1280]) {
    test(`drills ${state} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      await mount(page, "DrillsFixture", { texts: REAL_TEXTS, brand, view: DRILLS_STATES[state]() }, { lang: "en" });

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Drills");
      await noScroll(page);
      const start = page.getByRole("button", { name: "Start a drill" });
      await expect(start).toBeVisible();
      expect((await start.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(page.getByTestId("drills-roster-link")).toHaveAttribute("href", "/staff/drills/roster");
      if (state === "with-a-drill") {
        await expect(page.getByTestId("drill")).toHaveCount(1);
        await expect(page.getByTestId("drill-result-row")).toHaveCount(5);
        await expect(page.getByTestId("drill-results")).toContainText("Handed off: 3");
        await expect(page.getByTestId("drill-results")).toContainText("Removed from the roster");
        await expect(page.getByTestId("drill-unknown-note")).toBeVisible();
      }
      if (state === "no-drill") await expect(page.getByTestId("drills-none")).toBeVisible();
      if (state === "empty-roster") await expect(page.getByTestId("drills-roster-summary")).toContainText("a drill reaches no one yet");
      await expectBaseline(page, `drills-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}

for (const state of Object.keys(ROSTER_STATES) as (keyof typeof ROSTER_STATES)[]) {
  for (const width of [390, 1280]) {
    test(`drill roster ${state} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      await mount(page, "DrillRosterFixture", { texts: REAL_TEXTS, brand, ...ROSTER_STATES[state]() }, { lang: "en" });

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Drill roster");
      await noScroll(page);
      const add = page.getByRole("button", { name: "Add phone" });
      await expect(add).toBeVisible();
      expect((await add.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      if (state === "empty" || state === "unreadable") {
        await expect(page.getByTestId("drill-roster-list")).toHaveCount(0);
      } else {
        await expect(page.getByTestId("drill-roster-row")).toHaveCount(state === "removed-answer" ? 1 : 2);
        // Only the last four digits of a number are on the page, and every Remove button names its owner and is big enough to press.
        await expect(page.getByTestId("drill-roster-list")).toContainText("+1 ••• ••• 0123");
        await expect(page.getByTestId("drill-roster-list")).not.toContainText("416");
        const remove = page.getByRole("button", { name: /^Remove/ }).first();
        expect((await remove.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      if (state === "empty") await expect(page.getByTestId("drill-roster-empty")).toContainText("The drill roster is empty.");
      if (state === "added-answer") await expect(page.getByTestId("drill-roster-answer")).toContainText("The roster now has 2 phones.");
      if (state === "removed-answer") await expect(page.getByTestId("drill-roster-answer")).toContainText("2 waiting drill texts to that phone were cancelled.");
      if (state === "refused") await expect(page.getByRole("alert")).toContainText("That number is already on the roster.");
      if (state === "unreadable") await expect(page.getByTestId("drill-roster-unreadable")).toContainText("could not read the drill roster");
      await expectBaseline(page, `drill-roster-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}

test("a roster phone's Edit form, opened, at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: HEIGHT });
  await mount(page, "DrillRosterFixture", { texts: REAL_TEXTS, brand, ...ROSTER_STATES.list() }, { lang: "en" });
  await page.getByTestId("drill-roster-row").first().locator("summary").click();
  await expect(page.getByRole("button", { name: "Save changes" }).first()).toBeVisible();
  await expect(page.getByText("Leave empty to keep the number.").first()).toBeVisible();
  await noScroll(page);
  await fit(page, 390);
  await expectBaseline(page, "drill-roster-en-edit-open-390.png", { fullPage: true });
});

// "Start a drill" and a drill's composer carry the exercise marker (X-10) above their heading.
const PLANS: BuildingFloorPlan[] = [{ rsn: "4154146", address: "4 Milepost Pl", neighbourhoodId: "TP", neighbourhoodName: "Thorncliffe Park", floors: [] }];
const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";

function drillState(): EntryState {
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: true, reportedAt: new Date("2026-10-05T13:30:00Z"), status: "open" },
    entry: {
      id: ENTRY,
      alertId: ALERT,
      kind: "ack",
      status: "draft",
      authorId: "01900000-0000-7000-8000-0000000000c1",
      editorIds: [],
      content: {
        text: "The elevator at 4 Milepost Pl is out of service. We are finding out more.",
        types: ["elevator"],
        audience: { scope: "buildings", buildings: [{ rsn: "4154146", floors: null }], groups: [], types: ["elevator"] },
        phase: "problem",
        validUntil: new Date("2026-10-06T14:00:00Z"),
      },
      version: 0,
      contentHash: null,
      submittedAt: null,
      returnedFor: null,
      returnedNote: null,
      approvedBy: null,
      approvedAt: null,
      webPublishedAt: null,
      possibleDuplicateOf: null,
    } as unknown as EntryState["entry"],
    attempt: null,
    translations: [],
  };
}

for (const width of [390, 1280]) {
  test(`Start a drill at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mount(page, "LogFixture", { texts: REAL_TEXTS, brand, screen: logScreen(PLANS, NOW, { kind: "ack", drill: true }) });
    await fit(page, width);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Start a drill");
    await expect(page.getByTestId("exercise-marker")).toContainText("Exercise. This is practice.");
    await expect(page.getByTestId("exercise-marker")).toContainText("Nothing here is sent to residents.");
    await noScroll(page);
    await expectBaseline(page, `drill-start-${width}.png`);
  });

  test(`a drill's acknowledgement composer carries the exercise marker at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const screen = composerScreen({
      mode: "ack",
      state: drillState(),
      plans: PLANS,
      preview: { sms: { body: "Exercise. Practice only.\nThorncliffe Flemingdon Hub: The elevator at 4 Milepost Pl is out of service.", encoding: "gsm7", segments: 1 }, nineOneOneFirst: false },
      saved: false,
      now: NOW,
    });
    await mount(page, "ComposerFixture", { texts: REAL_TEXTS, brand, screen });
    await fit(page, width);
    await expect(page.getByTestId("exercise-marker")).toBeVisible();
    await noScroll(page);
    await expectBaseline(page, `drill-composer-${width}.png`);
  });
}
