import { expect, test, type Page } from "@playwright/test";
import { roundTypesView } from "../../src/app/staff/coverage/rounds/roundTypes";
import { coverageBuildingView, coverageListView, savedNotice, type CoverageListView } from "../../src/app/staff/coverage/view";
import type { AmbassadorOption, AssignmentView } from "../../src/modules/identity";
import type { BuildingFloorPlan } from "../../src/modules/places";
import { REAL_TEXTS, expectShellDoesNotOverflow, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S01.14: the coverage screen inside the Hub shell, at 390 and 1280 px: the list of buildings with the covered and
// uncovered floors written out, one building as an Admin sees it (floors, assignments, the form to assign) and as a
// Director sees it (read-only), and the form after a refusal. The views are built by the app's own view functions
// from sample buildings (dates on or before 2026-10-01), the screen is the app's own CoverageBody with actions that do
// nothing. The behaviour is asserted in e2e/staff/coverage.spec.ts and src/app/staff/coverage/CoverageBody.test.tsx;
// these pictures show what it looks like. The staff screens are English in the pilot, so there is no ur picture. S08.06: below the list, the types
// that start a check-in round, with the Admin's form to change them (the list pictures are an Admin's), a Director's read-only words, and the
// form's answers after a save and after a refusal.
const brand = hubBrand();

const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;

const plan = (rsn: string, address: string, labels: string[], change: Partial<BuildingFloorPlan> = {}): BuildingFloorPlan => ({
  rsn,
  address,
  neighbourhoodId: "TP",
  neighbourhoodName: "Thorncliffe Park",
  floors: labels.map((label, index) => ({ id: floorId(rsn, index), label, sortOrder: index })),
  ...change,
});

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => String(from + index));

const PLANS: BuildingFloorPlan[] = [
  plan("4154146", "4 Milepost Pl", ["G", ...range(1, 6)]),
  plan("4154159", "85-95 Thorncliffe Park Dr", ["G", ...range(1, 12)]),
  plan("4154169", "26 Thorncliffe Park Dr", range(1, 8)),
  plan("4154175", "2 Thorncliffe Park Dr", range(1, 5)),
  plan("4154763", "5 Dufresne Crt", ["G", ...range(1, 4)], { neighbourhoodId: "FP", neighbourhoodName: "Flemingdon Park" }),
  plan("4244530", "35 St Dennis Dr", [], { neighbourhoodId: "FP", neighbourhoodName: "Flemingdon Park" }),
];

const NIA = "01900000-0000-7000-8000-0000000000a1";
const OMAR = "01900000-0000-7000-8000-0000000000a2";
const LEE = "01900000-0000-7000-8000-0000000000a3";

const assignment = (change: Partial<AssignmentView> & Pick<AssignmentView, "rsn" | "floorIds">): AssignmentView => ({
  staffId: NIA,
  firstName: "Nia",
  lastName: "Mensah",
  role: "ambassador",
  status: "active",
  covering: true,
  assignedAt: new Date("2026-10-01T12:00:00Z"),
  ...change,
});

const ASSIGNMENTS: AssignmentView[] = [
  // Every floor of 4 Milepost Pl; floors G to 4 and 6 of 85-95 Thorncliffe Park Dr; a suspended ambassador on 26 Thorncliffe Park Dr.
  assignment({ rsn: "4154146", floorIds: null }),
  assignment({ rsn: "4154159", staffId: OMAR, firstName: "Omar", lastName: "Farouk", floorIds: [0, 1, 2, 3, 4, 6].map((index) => floorId("4154159", index)) }),
  assignment({ rsn: "4154169", staffId: LEE, firstName: "Lee", lastName: "Park", status: "suspended", covering: false, floorIds: null }),
  assignment({ rsn: "4154175", floorIds: [floorId("4154175", 0), floorId("4154175", 1)] }),
];

const AMBASSADORS: AmbassadorOption[] = [
  { staffId: NIA, firstName: "Nia", lastName: "Mensah" },
  { staffId: OMAR, firstName: "Omar", lastName: "Farouk" },
  { staffId: "01900000-0000-7000-8000-0000000000a4", firstName: "Sam", lastName: "Reyes" },
];

/** S08.06: the pilot's types of disruption, heat and power starting a round. */
const ROUND_TYPES = ["elevator", "fire", "flood", "heat", "other", "power", "smoke", "water", "winter"].map((id) => ({ id, round: id === "heat" || id === "power" }));
/** The list as the page draws it: the buildings, then the round types as an Admin (`editable`) or anyone else sees them. */
const listWithRounds = (list: CoverageListView, editable = true): CoverageListView => ({ ...list, rounds: roundTypesView(ROUND_TYPES, { editable }) });

async function open(page: Page, width: number, props: Omit<Parameters<typeof mount<"CoverageFixture">>[2], "texts" | "brand">, height = 1100) {
  await page.setViewportSize({ width, height });
  await mount(page, "CoverageFixture", { texts: REAL_TEXTS, brand, ...props });
}

for (const width of [390, 1280]) {
  test(`coverage list at ${width}px`, async ({ page }) => {
    await open(page, width, { screen: listWithRounds(coverageListView(PLANS, ASSIGNMENTS)) }, width === 390 ? 2000 : 1600);
    await expect(page.getByTestId("screen")).toContainText("Buildings with every floor covered: 1 of 6.");
    await expect(page.getByTestId("round-types-current")).toHaveText("Types that start a round now: Heat, Power.");
    await expect(page.getByRole("checkbox", { name: "Heat" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Water" })).not.toBeChecked();
    await expectBaseline(page, `coverage-list-${width}.png`);
  });

  test(`a building as an Admin sees it at ${width}px: floors, assignments, and the form to assign`, async ({ page }) => {
    const screen = coverageBuildingView(PLANS[1], ASSIGNMENTS, { notice: savedNotice({ done: "assigned" }), ambassadors: AMBASSADORS });
    await open(page, width, { screen }, width === 390 ? 2900 : 1900);
    await expectBaseline(page, `coverage-building-admin-${width}.png`);
  });
}

test("a building as a Director sees it at 390px: read-only, with no form and no button", async ({ page }) => {
  await open(page, 390, { screen: coverageBuildingView(PLANS[1], ASSIGNMENTS) }, 1700);
  await expect(page.getByTestId("screen").locator("form, button")).toHaveCount(0);
  await expectBaseline(page, "coverage-building-director-390.png");
});

test("a building with an ambassador who is not covering now at 390px", async ({ page }) => {
  await open(page, 390, { screen: coverageBuildingView(PLANS[2], ASSIGNMENTS) }, 1300);
  await expect(page.getByTestId("screen")).toContainText("Not covering now: the account is suspended.");
  await expectBaseline(page, "coverage-building-inactive-390.png");
});

test("the assign form after a refusal at 390px", async ({ page }) => {
  await open(
    page,
    390,
    {
      screen: coverageBuildingView(PLANS[3], ASSIGNMENTS, { ambassadors: AMBASSADORS }),
      initial: {
        assign: { status: "refused", message: "Choose at least one floor, or choose all floors." },
        remove: { [NIA]: { status: "refused", message: "That ambassador is not assigned to this building." } },
      },
    },
    2200,
  );
  await expectBaseline(page, "coverage-refused-390.png");
});

test("removing an assignment asks first, at 390px: the question, the confirm and the way to keep it", async ({ page }) => {
  await open(
    page,
    390,
    {
      screen: coverageBuildingView(PLANS[1], ASSIGNMENTS, { ambassadors: AMBASSADORS }),
      initial: { remove: { [OMAR]: { status: "confirm", message: "Remove Omar Farouk from this building? They stay an ambassador and stop covering it." } } },
    },
    2900,
  );
  await expect(page.getByTestId(`assignment-${OMAR}`)).toContainText("Remove Omar Farouk from this building? They stay an ambassador and stop covering it.");
  await expect(page.getByRole("button", { name: "Yes, remove Omar Farouk" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep Omar Farouk" })).toBeVisible();
  await expectBaseline(page, "coverage-remove-confirm-390.png");
});

test("all 43 buildings list their floors in words and fit the phone without scrolling sideways", async ({ page }) => {
  const forty3 = Array.from({ length: 43 }, (_, index) => plan(String(4154000 + index), `${index + 1} Test Dr`, ["G", ...range(1, 4 + (index % 9))]));
  const list = coverageListView(forty3, [assignment({ rsn: "4154000", floorIds: null }), assignment({ rsn: "4154001", floorIds: [floorId("4154001", 0)] })]);
  await open(page, 390, { screen: list }, 900);

  await expect(page.locator("li[data-testid^='coverage-4']")).toHaveCount(43);
  for (const text of await page.locator("li[data-testid^='coverage-4']").allInnerTexts()) expect(text).toMatch(/Covered:|Not covered:/);
  await expectShellDoesNotOverflow(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

// S08.05: the check-in requests on floors without an ambassador, per building and in all: a count, never who.
test("the list with check-in requests on floors without an ambassador at 390px", async ({ page }) => {
  const requests = [
    { rsn: "4154159", floorId: floorId("4154159", 5), requests: 2 },
    { rsn: "4154169", floorId: floorId("4154169", 0), requests: 1 },
    { rsn: "4154146", floorId: floorId("4154146", 1), requests: 4 },
  ];
  await open(page, 390, { screen: coverageListView(PLANS, ASSIGNMENTS, undefined, requests) }, 1900);
  await expect(page.getByTestId("coverage-requests-summary")).toContainText("in all buildings: 3.");
  await expect(page.getByTestId("coverage-requests-4154159")).toHaveText("Check-in requests on floors without an ambassador: 2");
  await expect(page.getByTestId("coverage-requests-4154146")).toHaveCount(0);
  await expectBaseline(page, "coverage-list-requests-390.png");
});

// S08.06: which types start a check-in round. A Director (and a Coordinator) reads them in words, with no form; an Admin's save is answered in the
// form's live region, and a refusal in the Hub's error style, nothing changed.
test("the round types as a Director reads them at 390px: words only, no form", async ({ page }) => {
  await open(page, 390, { screen: listWithRounds(coverageListView(PLANS.slice(0, 1), ASSIGNMENTS), false) }, 800);
  await expect(page.getByTestId("round-types").locator("form, button, input")).toHaveCount(0);
  await expect(page.getByTestId("round-types-read-only")).toHaveText("Only an Admin can change which types start a round.");
  await expectBaseline(page, "coverage-rounds-director-390.png");
});

test("the round types after an Admin saved them, and after a refusal, at 390px", async ({ page }) => {
  const screen = listWithRounds(coverageListView(PLANS.slice(0, 1), ASSIGNMENTS));
  await open(page, 390, { screen, initial: { roundTypes: { status: "done", line: "Saved. Types that start a round from the next approval: Heat, Power.", at: 1 } } }, 1450);
  await expect(page.getByTestId("round-types-answer")).toHaveText("Saved. Types that start a round from the next approval: Heat, Power.");
  await expectBaseline(page, "coverage-rounds-saved-390.png");

  await open(page, 390, { screen, initial: { roundTypes: { status: "refused", message: "Nothing to change: those are the round types already.", at: 1 } } }, 1450);
  await expect(page.getByTestId("round-types-error")).toHaveText("Nothing to change: those are the round types already.");
  await expectBaseline(page, "coverage-rounds-refused-390.png");
});
