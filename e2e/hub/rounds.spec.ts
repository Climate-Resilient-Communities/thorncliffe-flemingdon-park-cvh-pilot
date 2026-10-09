import { expect, test, type Page } from "@playwright/test";
import { progressScreen, unreadableProgress, type ClosedPlace, type ProgressSources } from "../../src/app/staff/rounds/progress";
import { escalationScreen, roundsScreen, type DescribedEscalation, type EscalationViewer, type ResidentFacts } from "../../src/app/staff/rounds/view";
import { englishText } from "../../src/i18n/text";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S08.08: "Check-in rounds" (O-17, the pilot's version: the escalations to follow up) and an escalation's page in the Hub shell, in en: the list with an open
// needs help, an open not reached from a late mark (call the ambassador) and one handled; the list with none waiting; an escalation as an Admin at aal2 sees it
// (the resident's fictional number as a call link, the floor and the method, and "Mark handled"), as a Coordinator sees it (no number), a late mark's
// (building, floor and ambassador only) and a handled one. S08.09: below the escalations, the rounds' counts by building and floor: an open heat round's
// live counts in two buildings and a power round closed with its tally ("list"); no round running and none closed ("none-waiting"); counts that could not
// be read ("counts-unreadable"); more threads closed in 7 days than the page reads, so it says before when a round may be missing ("closed-cut"). The
// screens are the app's own view functions' output; the behaviour is asserted in src/app/staff/rounds, test/db/escalations.db.test.ts and
// test/db/roundCounts.db.test.ts. These pictures show what it looks like.
const brand = hubBrand();
const HEIGHT = 844;
const PHONE = "+14165550181";
const texts = { ...REAL_TEXTS, heading: englishText("staff.rounds.title"), paragraphs: [englishText("staff.rounds.lead")] };

const at = (iso: string) => new Date(iso);
const HELP: DescribedEscalation = {
  id: "0199b6f2-7c3a-7d41-9e2b-4f6a8c1d2e3f",
  status: "needs_help",
  building: "85-95 Thorncliffe Park Dr",
  floor: "12",
  raisedBy: "Amina Yusuf",
  late: false,
  createdAt: at("2026-07-14T18:42:00Z"),
  handled: null,
};
const LATE: DescribedEscalation = { ...HELP, id: "0199b6f2-7c3a-7d41-9e2b-4f6a8c1d2e40", status: "not_reached", floor: "4", raisedBy: "Daniel Okoro", late: true, createdAt: at("2026-07-14T19:05:00Z") };
const HANDLED: DescribedEscalation = {
  ...HELP,
  id: "0199b6f2-7c3a-7d41-9e2b-4f6a8c1d2e41",
  status: "not_reached",
  building: "18 Thorncliffe Park Dr",
  floor: "7",
  createdAt: at("2026-07-14T17:20:00Z"),
  handled: { at: at("2026-07-14T17:48:00Z"), by: "Priya Sharma", note: "Reached her by phone. She is staying with her daughter tonight." },
};
const ADMIN: EscalationViewer = { followUp: true, aal2: true };
const COORDINATOR: EscalationViewer = { followUp: false, aal2: false };
// UAT note 9: the resident chose Urdu, which the page says beside the number.
const LINKED: ResidentFacts = { kind: "linked", phone: PHONE, method: "call", lang: "ur" };
const e = (key: string) => englishText(`staff.rounds.escalation.${key}`);
const formLabels = { heading: e("markHeading"), note: e("note"), noteHint: e("noteHint"), mark: e("mark"), marking: e("marking"), noteMax: 300 };

// The rounds' counts: a heat round open in two buildings (its rows by latest mark) and a power round closed the evening before, with its tally.
const HEAT = "0199b6f2-0000-7000-8000-0000000000a1";
const POWER = "0199b6f2-0000-7000-8000-0000000000a2";
const TALL = { rsn: "7001", address: "85-95 Thorncliffe Park Dr", floors: ["3", "4", "7", "12"].map((label) => ({ id: `t${label}`, label })) };
const LOW = { rsn: "7002", address: "18 Thorncliffe Park Dr", floors: ["1", "2"].map((label) => ({ id: `l${label}`, label })) };
const live = (rsn: string, floorId: string, status: "pending" | "done" | "not_reached" | "needs_help", times = 1) =>
  Array.from({ length: times }, () => ({ alertId: HEAT, rsn, floorId, status }));
const closedAt = (rsn: string, floorId: string, counts: Partial<ClosedPlace["counts"]>): ClosedPlace => ({
  alertId: POWER,
  rsn,
  floorId,
  counts: { requested: 0, done: 0, not_reached: 0, needs_help: 0, withdrawn: 0, unmarked: 0, ...counts },
});
const COUNTS: ProgressSources = {
  rows: [
    ...live("7001", "t12", "needs_help"),
    ...live("7001", "t12", "done", 2),
    ...live("7001", "t12", "pending"),
    ...live("7001", "t4", "not_reached"),
    ...live("7001", "t4", "pending", 2),
    ...live("7001", "t3", "done", 3),
    ...live("7002", "l2", "pending"),
    ...live("7002", "l1", "done"),
  ],
  headlines: new Map([[HEAT, "Extreme heat warning. Cooling centres are open until 11 p.m."]]),
  closed: [{ alertId: POWER, types: ["power"], closedAt: at("2026-07-13T23:40:00Z") }],
  closedCutAt: null,
  closedPlaces: [
    closedAt("7001", "t7", { requested: 4, done: 2, not_reached: 1, withdrawn: 1 }),
    closedAt("7001", "t12", { requested: 3, done: 1, needs_help: 1, unmarked: 1 }),
    closedAt("7002", "l1", { requested: 1, done: 1 }),
  ],
  plans: [LOW, TALL],
};

const LISTS = {
  list: () => ({ screen: roundsScreen([LATE, HELP, HANDLED]), progress: progressScreen(COUNTS) }),
  "none-waiting": () => ({ screen: roundsScreen([HANDLED]), progress: progressScreen({ ...COUNTS, rows: [], closedPlaces: [] }) }),
  "counts-unreadable": () => ({ screen: roundsScreen([HELP]), progress: unreadableProgress() }),
  "closed-cut": () => ({ screen: roundsScreen([HANDLED]), progress: progressScreen({ ...COUNTS, rows: [], closedCutAt: at("2026-07-13T23:40:00Z") }) }),
} as const;

const PAGES = {
  admin: () => ({ screen: escalationScreen(HELP, ADMIN, LINKED), form: { id: HELP.id, open: true, labels: formLabels, answer: { status: "idle" as const } } }),
  coordinator: () => ({ screen: escalationScreen(HELP, COORDINATOR, LINKED) }),
  late: () => ({ screen: escalationScreen(LATE, ADMIN, LINKED), form: { id: LATE.id, open: true, labels: formLabels, answer: { status: "idle" as const } } }),
  handled: () => ({ screen: escalationScreen(HANDLED, ADMIN, { kind: "unlinked" }), form: { id: HANDLED.id, open: false, labels: formLabels, answer: { status: "done" as const, at: 1, line: e("doneClosed") } } }),
} as const;

async function noSidewaysScroll(page: Page) {
  const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
}

for (const state of Object.keys(LISTS) as (keyof typeof LISTS)[]) {
  for (const width of [390, 1280]) {
    test(`check-in rounds ${state} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      await mount(page, "RoundsFixture", { texts, brand, ...LISTS[state]() }, { lang: "en" });

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check-in rounds");
      await noSidewaysScroll(page);
      if (state === "list") {
        await expect(page.getByTestId("escalations-open").getByTestId("escalation-item")).toHaveCount(2);
        await expect(page.getByTestId("escalations-open")).toContainText("Needs help: 85-95 Thorncliffe Park Dr, floor 12");
        await expect(page.getByTestId("escalation-late")).toContainText("call the ambassador");
        await expect(page.getByTestId("escalations-handled")).toContainText("Handled by Priya Sharma");
        const open = page.getByTestId("escalation-open").first();
        expect((await open.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await expect(page.getByTestId("progress-open-round")).toHaveCount(1);
        await expect(page.getByTestId("progress-open").getByTestId("progress-floor")).toHaveCount(5);
        await expect(page.getByTestId("progress-open").getByTestId("progress-building").first()).toContainText("18 Thorncliffe Park Dr");
        await expect(page.getByTestId("progress-closed-round")).toContainText("Power: round closed");
        await expect(page.getByTestId("progress-closed").getByTestId("progress-total")).toContainText("Withdrawn: 1");
      } else if (state === "none-waiting") {
        await expect(page.getByTestId("escalations-none")).toHaveText("None waiting. Every escalation has been handled.");
        await expect(page.getByTestId("progress-none")).toContainText("No check-in round is running now.");
        await expect(page.getByTestId("progress-closed-none")).toHaveText("No round closed in the last 7 days.");
      } else if (state === "closed-cut") {
        await expect(page.getByTestId("progress-closed-cut")).toContainText("a round that closed before Monday, July 13, 2026 at 7:40 p.m. EDT may be missing here.");
        await expect(page.getByTestId("progress-closed-round")).toContainText("Power: round closed");
      } else {
        await expect(page.getByTestId("progress-unreadable")).toContainText("The Hub could not read the round counts.");
        await expect(page.getByTestId("escalations-open").getByTestId("escalation-item")).toHaveCount(1);
      }
      await expect(page.locator("body")).not.toContainText("555");
      await expectBaseline(page, `rounds-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}

for (const state of Object.keys(PAGES) as (keyof typeof PAGES)[]) {
  for (const width of [390, 1280]) {
    test(`an escalation, ${state}, at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      await mount(page, "EscalationFixture", { texts, brand, ...PAGES[state]() }, { lang: "en" });

      await noSidewaysScroll(page);
      if (state === "admin") {
        await expect(page.getByTestId("escalation-phone")).toHaveAttribute("href", `tel:${PHONE}`);
        await expect(page.getByTestId("escalation-resident")).toContainText("a call");
        await expect(page.getByTestId("escalation-phone")).toHaveText("(416) 555-0181");
        await expect(page.getByTestId("escalation-language")).toHaveText("LanguageUrdu");
        const mark = page.getByRole("button", { name: "Mark handled" });
        await expect(mark).toBeVisible();
        expect((await mark.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      } else {
        await expect(page.locator("body")).not.toContainText(PHONE);
      }
      if (state === "coordinator") await expect(page.getByTestId("escalation-resident-admin_only")).toContainText("Only an Admin sees the resident's number.");
      if (state === "late") {
        await expect(page.getByTestId("escalation-late")).toContainText("Call the ambassador to follow up.");
        await expect(page.getByTestId("escalation-resident")).toHaveCount(0);
      }
      if (state === "handled") {
        await expect(page.getByTestId("escalation-handled")).toContainText("Reached her by phone.");
        await expect(page.getByTestId("escalation-resident-gone")).toBeVisible();
        await expect(page.getByRole("button", { name: "Mark handled" })).toHaveCount(0);
      }
      await expectBaseline(page, `escalation-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}
