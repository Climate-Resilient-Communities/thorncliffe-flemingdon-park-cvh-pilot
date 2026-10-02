import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Audience } from "@/contracts/audience";
import type { BuildingFloorPlan } from "@/modules/places";
import { AudienceBody, type AudienceActions } from "./AudienceBody";
import { asideOf, groupsScreen, lockedScreen, missingScreen, placeScreen, savedNotice } from "./view";

const noop = async () => ({ status: "idle" as const });
const actions: AudienceActions = { place: noop, groups: noop };

const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;
const plan = (rsn: string, address: string, labels: string[], change: Partial<BuildingFloorPlan> = {}): BuildingFloorPlan => ({
  rsn,
  address,
  neighbourhoodId: "TP",
  neighbourhoodName: "Thorncliffe Park",
  floors: labels.map((label, index) => ({ id: floorId(rsn, index), label, sortOrder: index })),
  ...change,
});

const PLANS: BuildingFloorPlan[] = [
  plan("4154146", "4 Milepost Pl", ["G", "1", "2", "3", "4", "5", "6"]),
  plan("4154159", "85-95 Thorncliffe Park Dr", ["G", "1", "2", "3"]),
  plan("4154763", "5 Dufresne Crt", ["G", "1", "2"], { neighbourhoodId: "FP", neighbourhoodName: "Flemingdon Park" }),
  plan("4244530", "35 St Dennis Dr", [], { neighbourhoodId: "FP", neighbourhoodName: "Flemingdon Park" }),
];
const REF = { alertId: "01900000-0000-7000-8000-00000000a1e7", entryId: "01900000-0000-7000-8000-00000000e177" };

const NEIGHBOURHOOD: Audience = { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power"] };
const BUILDINGS: Audience = {
  scope: "buildings",
  buildings: [
    { rsn: "4154146", floors: null },
    { rsn: "4154159", floors: [floorId("4154159", 1), floorId("4154159", 2)] },
  ],
  groups: ["seniors", "families"],
  types: ["power"],
};

/** The <input> of a control by its name and value (React writes the attributes in its own order). */
function input(out: string, name: string, value: string): string {
  const tag = (out.match(/<input [^>]*>/g) ?? []).find((candidate) => candidate.includes(` name="${name}"`) && candidate.includes(` value="${value}"`));
  if (!tag) throw new Error(`no input ${name}=${value}`);
  return tag;
}
const checkedBox = (out: string, name: string, value: string) => input(out, name, value).includes(' checked=""');

const html = (screen: Parameters<typeof AudienceBody>[0]["screen"]) => renderToStaticMarkup(<AudienceBody screen={screen} actions={actions} />);

describe("O-03, the place picker", () => {
  it("lists all the buildings by neighbourhood, with the neighbourhoods to choose and the scope chosen, not assumed", () => {
    const out = html(placeScreen(PLANS, { ...NEIGHBOURHOOD, scope: "neighbourhood" }, REF));
    expect(out).toContain("<h1>Who is this alert for? The place</h1>");
    expect(out.match(/data-testid="building-\d+"/g)).toHaveLength(4);
    expect(out).toContain("Thorncliffe Park (2)");
    expect(out).toContain("Flemingdon Park (2)");
    expect(checkedBox(out, "neighbourhood", "TP")).toBe(true);
    expect(checkedBox(out, "neighbourhood", "FP")).toBe(false);
    expect(checkedBox(out, "scope", "neighbourhood")).toBe(true);
    expect(checkedBox(out, "scope", "buildings")).toBe(false);
  });

  it("uses the Hub's checkbox style for every choice, and the two-column grid", () => {
    const out = html(placeScreen(PLANS, BUILDINGS, REF));
    expect(out).toContain('class="layout-grid" data-two-column="aside"');
    expect(checkedBox(out, "building", "4154146")).toBe(true);
    expect(checkedBox(out, "building", "4154763")).toBe(false);
    expect(checkedBox(out, "floor-4154159", floorId("4154159", 1))).toBe(true);
    expect(checkedBox(out, "floor-4154159", floorId("4154159", 0))).toBe(false);
    expect(checkedBox(out, "floors-4154146", "all")).toBe(true);
    expect(checkedBox(out, "floors-4154159", "some")).toBe(true);
    // Every checkbox and radio of the page is a .hub-choice; none stands bare.
    const controls = out.match(/<input type="(?:checkbox|radio)"/g)?.length ?? 0;
    expect(out.match(/<label class="hub-choice"><input type="(?:checkbox|radio)"/g)?.length).toBe(controls);
  });

  it("opens the floors of a ticked building, offers a range between two floors, and says when a building lists none", () => {
    const out = html(placeScreen(PLANS, BUILDINGS, REF));
    expect(out).toMatch(/<details open=""><summary class="tap hub-link">Some floors<\/summary>/);
    expect(out).toContain("Or every floor from one to another, in the order the building lists them");
    expect(out).toContain('name="from-4154159"');
    expect(out).toContain('name="to-4154159"');
    expect(out).toContain("No floors are listed for this building, so only the whole building can be chosen.");
    // The building with no floors can only be chosen whole.
    expect(input(out, "floors-4244530", "some")).toContain('disabled=""');
  });

  it("carries the draft in hidden fields and has one Save button", () => {
    const out = html(placeScreen(PLANS, NEIGHBOURHOOD, REF));
    expect(out).toContain(`<input type="hidden" name="alert" value="${REF.alertId}"/>`);
    expect(out).toContain(`<input type="hidden" name="entry" value="${REF.entryId}"/>`);
    expect(out.match(/type="submit"/g)).toHaveLength(1);
    expect(out).toContain("Save the place");
  });

  it("says who gets it now in words: the saved neighbourhood, or the buildings with their floors, and that no-floor residents are included", () => {
    expect(asideOf(NEIGHBOURHOOD, PLANS, { href: "/g", label: "g" }).sentence).toBe("Everyone living in Thorncliffe Park.");
    expect(asideOf({ ...NEIGHBOURHOOD, neighbourhood_ids: ["FP", "TP"] }, PLANS, { href: "/g", label: "g" }).sentence).toBe("Everyone living in Flemingdon Park and Thorncliffe Park.");
    const aside = asideOf(BUILDINGS, PLANS, { href: "/g", label: "g" });
    expect(aside.sentence).toBe("Residents of 4 Milepost Pl (all floors) and 85-95 Thorncliffe Park Dr (floors 1, 2).");
    expect(aside.floorNote).toBe("Residents who did not say which floor they live on in a building you chose floors for get it too.");
    expect(aside.groups).toBe("Groups chosen: Seniors and Families with young children. Texts go only to residents who chose one of them.");
    expect(asideOf(NEIGHBOURHOOD, PLANS, { href: "/g", label: "g" }).groups).toBe("No group chosen: texts go to everyone in the place.");
  });

  it("puts the main column first and the aside after it, as two cells of the grid", () => {
    const out = html(placeScreen(PLANS, BUILDINGS, REF));
    const main = out.indexOf('data-gap="section-hub-main"');
    const aside = out.indexOf('data-testid="audience-aside"');
    expect(main).toBeGreaterThan(-1);
    expect(aside).toBeGreaterThan(main);
    expect(out.indexOf("Save the place")).toBeLessThan(aside);
  });

  it("shows the saved notice", () => {
    expect(savedNotice({ done: "place" })).toBe("The place is saved.");
    expect(savedNotice({ done: "groups" })).toBe("The groups are saved.");
    expect(savedNotice({ done: "something else" })).toBeUndefined();
    expect(html(placeScreen(PLANS, NEIGHBOURHOOD, REF, { notice: savedNotice({ done: "place" }) }))).toContain('<p role="status">The place is saved.</p>');
  });
});

describe("O-04, the group picker", () => {
  it("lists the groups residents choose, ticks the stored ones, and notes that groups narrow texts but every web reader still sees the alert", () => {
    const out = html(groupsScreen(PLANS, BUILDINGS, REF));
    expect(out).toContain("<h1>Who is this alert for? The groups</h1>");
    for (const group of ["seniors", "newcomers", "families", "checkin"]) expect(input(out, "group", group)).toContain('type="checkbox"');
    expect(checkedBox(out, "group", "seniors")).toBe(true);
    expect(checkedBox(out, "group", "families")).toBe(true);
    expect(checkedBox(out, "group", "newcomers")).toBe(false);
    expect(checkedBox(out, "group", "checkin")).toBe(false);
    expect(out).toContain("Groups narrow who is texted. Everyone who opens the web app can still see the alert.");
    expect(out).toContain('<label class="hub-choice"><input type="checkbox" name="group"');
  });

  it("shows the place beside the groups, with the way back to change it", () => {
    const out = html(groupsScreen(PLANS, NEIGHBOURHOOD, REF));
    expect(out).toContain("Everyone living in Thorncliffe Park.");
    expect(out).toContain(`href="/staff/alerts/audience?alert=${REF.alertId}&amp;entry=${REF.entryId}">Change the place</a>`);
    expect(out).toContain("Save the groups");
  });
});

describe("a draft that is not there or is no longer a draft", () => {
  it("says it was not found, with the way back", () => {
    const out = html(missingScreen());
    expect(out).toContain('<p role="alert">That alert draft was not found. Open it again from the list of alerts.</p>');
    expect(out).toContain('href="/staff"');
    expect(out).not.toContain("<form");
  });

  it("shows who the submitted alert was for, with no form", () => {
    const out = html(lockedScreen(PLANS, BUILDINGS));
    expect(out).toContain("This alert was already submitted, so who it is for cannot change. Pull it back to a draft first.");
    expect(out).toContain("Residents of 4 Milepost Pl (all floors)");
    expect(out).not.toContain("<form");
    expect(out).not.toContain("<button");
  });
});
