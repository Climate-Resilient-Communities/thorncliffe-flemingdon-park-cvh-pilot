import { expect, test, type Page } from "@playwright/test";
import { escalationScreen, roundsScreen, type DescribedEscalation, type EscalationViewer, type ResidentFacts } from "../../src/app/staff/rounds/view";
import { englishText } from "../../src/i18n/text";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S08.08: "Check-in rounds" (O-17, the pilot's version: the escalations to follow up) and an escalation's page in the Hub shell, in en: the list with an open
// needs help, an open not reached from a late mark (call the ambassador) and one handled; the list with none waiting; an escalation as an Admin at aal2 sees it
// (the resident's fictional number as a call link, the floor and the method, and "Mark handled"), as a Coordinator sees it (no number), a late mark's
// (building, floor and ambassador only) and a handled one. The screens are the app's own view functions' output; the behaviour is asserted in
// src/app/staff/rounds and test/db/escalations.db.test.ts. These pictures show what it looks like.
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
const LINKED: ResidentFacts = { kind: "linked", phone: PHONE, method: "call" };
const e = (key: string) => englishText(`staff.rounds.escalation.${key}`);
const formLabels = { heading: e("markHeading"), note: e("note"), noteHint: e("noteHint"), mark: e("mark"), marking: e("marking"), noteMax: 300 };

const LISTS = {
  list: () => roundsScreen([LATE, HELP, HANDLED]),
  "none-waiting": () => roundsScreen([HANDLED]),
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
      await mount(page, "RoundsFixture", { texts, brand, screen: LISTS[state]() }, { lang: "en" });

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check-in rounds");
      await noSidewaysScroll(page);
      if (state === "list") {
        await expect(page.getByTestId("escalations-open").getByTestId("escalation-item")).toHaveCount(2);
        await expect(page.getByTestId("escalations-open")).toContainText("Needs help: 85-95 Thorncliffe Park Dr, floor 12");
        await expect(page.getByTestId("escalation-late")).toContainText("call the ambassador");
        await expect(page.getByTestId("escalations-handled")).toContainText("Handled by Priya Sharma");
        const open = page.getByTestId("escalation-open").first();
        expect((await open.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      } else {
        await expect(page.getByTestId("escalations-none")).toHaveText("None waiting. Every escalation has been handled.");
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
