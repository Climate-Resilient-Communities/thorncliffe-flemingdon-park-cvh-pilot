import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AmbassadorOption, AssignmentView } from "@/modules/identity";
import type { BuildingFloorPlan } from "@/modules/places";
import { CoverageBody, type CoverageActions } from "./CoverageBody";
import { coverageBuildingView, coverageListView, coverageMissingView, savedNotice } from "./view";

const noop = async () => ({ status: "idle" as const });
const actions: CoverageActions = { assign: noop, remove: noop };

const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;

const plan = (rsn: string, labels: string[], change: Partial<BuildingFloorPlan> = {}): BuildingFloorPlan => ({
  rsn,
  address: `${rsn} Test Dr`,
  neighbourhoodId: "TP",
  neighbourhoodName: "Thorncliffe Park",
  floors: labels.map((label, index) => ({ id: floorId(rsn, index), label, sortOrder: index })),
  ...change,
});

const NIA = "01900000-0000-7000-8000-0000000000a1";
const OMAR = "01900000-0000-7000-8000-0000000000a2";

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

const html = (screen: Parameters<typeof CoverageBody>[0]["screen"]) => renderToStaticMarkup(<CoverageBody screen={screen} actions={actions} />);

describe("Coverage: the list of buildings", () => {
  it("shows every one of 43 buildings with its covered and uncovered floors written out", () => {
    const plans = Array.from({ length: 43 }, (_, index) => plan(String(4154000 + index), ["G", "1", "2", "3"], { address: `${index + 1} Test Dr` }));
    // Building 1: all floors by one ambassador. Building 2: floors G and 1. The rest: nobody.
    const out = html(
      coverageListView(plans, [
        assignment({ rsn: "4154000", floorIds: null }),
        assignment({ rsn: "4154001", floorIds: [floorId("4154001", 0), floorId("4154001", 1)], staffId: OMAR }),
      ]),
    );

    expect(out.match(/data-testid="coverage-\d/g)).toHaveLength(43);
    expect(out).toContain("Buildings with every floor covered: 1 of 43. Floors without an ambassador: 166.");
    expect(out).toContain("Every floor is covered.");
    expect(out).toContain("Floors covered: 2 of 4.");
    expect(out).toContain("No floor is covered.");
    expect(out).toMatch(/<span class="hub-cover__label">Covered:<\/span> G, 1, 2, 3/);
    expect(out).toMatch(/<span class="hub-cover__label">Covered:<\/span> G, 1</);
    expect(out).toMatch(/<span class="hub-cover__label">Not covered:<\/span> 2, 3</);
    expect(out).toMatch(/<span class="hub-cover__label">Not covered:<\/span> G, 1, 2, 3</);
  });

  it("writes the state in words as well as in colour: every coloured line carries its label, and the uncovered ones are notes", () => {
    const out = html(coverageListView([plan("1", ["G", "1"])], [assignment({ rsn: "1", floorIds: [floorId("1", 0)] })]));

    expect(out).toContain('<p class="hub-cover hub-cover--covered"><span class="hub-cover__label">Covered:</span> G</p>');
    expect(out).toContain('<p role="note" class="hub-cover hub-cover--uncovered"><span class="hub-cover__label">Not covered:</span> 1</p>');
  });

  it("does not count an ambassador who is not covering now (suspended, locked): their floors are uncovered", () => {
    const out = html(coverageListView([plan("1", ["G", "1"])], [assignment({ rsn: "1", floorIds: null, status: "suspended", covering: false })]));

    expect(out).toContain("No floor is covered.");
    expect(out).toContain("Not covered:</span> G, 1");
    expect(out).not.toContain("hub-cover--covered");
  });

  it("says when a building has no floors yet, and links each building to its own coverage page with an accessible name", () => {
    const out = html(coverageListView([plan("1", []), plan("2", ["G"])], []));

    expect(out).toContain("No floors are listed for this building yet.");
    expect(out).toContain('href="/staff/coverage?building=1"');
    expect(out).toContain('aria-label="Coverage of 2 Test Dr"');
    expect(out).toContain("Thorncliffe Park (2)");
  });

  it("groups by neighbourhood, says when nothing has been imported, and shows the notice as a status", () => {
    const out = html(coverageListView([plan("1", ["G"]), plan("2", ["G"], { neighbourhoodId: "FP", neighbourhoodName: "Flemingdon Park" })], [], "Assignment saved."));
    expect(out).toContain("Thorncliffe Park (1)");
    expect(out).toContain("Flemingdon Park (1)");
    expect(out).toContain('<p role="status">Assignment saved.</p>');
    expect(html(coverageListView([], []))).toContain("No buildings have been imported yet. Ask IT to run the buildings seed.");
  });

  it("has no form and no button: the list is the same for everyone who may see it", () => {
    const out = html(coverageListView([plan("1", ["G"])], []));
    expect(out).not.toContain("<form");
    expect(out).not.toContain("<button");
  });
});

describe("Coverage: one building", () => {
  const ambassadors: AmbassadorOption[] = [
    { staffId: NIA, firstName: "Nia", lastName: "Mensah" },
    { staffId: OMAR, firstName: "Omar", lastName: "Farouk" },
  ];
  const one = plan("7001", ["G", "1", "2"]);

  it("lists each floor with who covers it, or that nobody does, in words", () => {
    const out = html(coverageBuildingView(one, [assignment({ rsn: "7001", floorIds: [floorId("7001", 0), floorId("7001", 1)] })]));

    expect(out).toContain("<h1>7001 Test Dr</h1>");
    expect(out).toContain("Thorncliffe Park. Floors covered: 2 of 3.");
    expect(out).toContain('aria-label="Floor G: Covered by Nia Mensah"');
    expect(out).toContain('aria-label="Floor 2: Not covered"');
    expect(out).toMatch(/hub-cover--covered[^>]*><span class="hub-cover__label">G<\/span> Covered by Nia Mensah/);
    expect(out).toMatch(/hub-cover--uncovered[^>]*><span class="hub-cover__label">2<\/span> Not covered/);
  });

  it("lists the assignments with their floors, and says why one is not covering now", () => {
    const out = html(
      coverageBuildingView(one, [
        assignment({ rsn: "7001", floorIds: null }),
        assignment({ rsn: "7001", floorIds: [floorId("7001", 2), floorId("7001", 1)], staffId: OMAR, firstName: "Omar", lastName: "Farouk", status: "suspended", covering: false }),
        assignment({ rsn: "7001", floorIds: null, staffId: "01900000-0000-7000-8000-0000000000a3", firstName: "Lee", lastName: "Locked", status: "locked_pending_reissue", covering: false }),
        assignment({ rsn: "7001", floorIds: null, staffId: "01900000-0000-7000-8000-0000000000a4", firstName: "Ron", lastName: "Role", role: "coordinator", covering: false }),
        assignment({ rsn: "7002", floorIds: null, staffId: "01900000-0000-7000-8000-0000000000a5", firstName: "Elsewhere", lastName: "Person" }),
      ]),
    );

    expect(out).toContain("<strong>Nia Mensah</strong>. All floors.");
    // The floors are written in the building's order, whatever order they were stored in.
    expect(out).toContain("<strong>Omar Farouk</strong>. Floors 1, 2.");
    expect(out).toContain("Not covering now: the account is suspended.");
    expect(out).toContain("Not covering now: the account is locked until an Admin re-issues the starting password.");
    expect(out).toContain("Not covering now: the account is no longer an ambassador.");
    expect(out).not.toContain("Elsewhere Person");
    // Floors covered only by the person who covers now.
    expect(out).toContain("Every floor is covered.");
  });

  it("says when nobody is assigned, and when the building has no floors", () => {
    expect(html(coverageBuildingView(one, []))).toContain("No ambassador is assigned to this building.");
    expect(html(coverageBuildingView(plan("9", []), []))).toContain("No floors are listed for this building yet.");
  });

  it("shows a Coordinator and a Director no form and no button (read-only): the assignments are text", () => {
    const out = html(coverageBuildingView(one, [assignment({ rsn: "7001", floorIds: null })]));

    expect(out).not.toContain("<form");
    expect(out).not.toContain("<button");
    expect(out).not.toContain("Assign an ambassador");
    expect(out).toContain("<strong>Nia Mensah</strong>");
  });

  it("gives an Admin the form to assign, with the active ambassadors and the floors as choices, and a Remove beside each assignment", () => {
    const out = html(coverageBuildingView(one, [assignment({ rsn: "7001", floorIds: null })], { ambassadors }));

    expect(out).toContain("Assign an ambassador");
    expect(out).toContain('<option value="" selected="">Choose an ambassador</option>');
    expect(out).toContain(`<option value="${NIA}">Nia Mensah</option>`);
    expect(out).toContain(`<option value="${OMAR}">Omar Farouk</option>`);
    expect(out).toContain('name="rsn" value="7001"');
    expect(out).toContain('name="scope" checked="" value="all"');
    expect(out).toContain('name="scope" value="some"');
    for (const index of [0, 1, 2]) expect(out).toContain(`name="floorId" value="${floorId("7001", index)}"`);
    expect(out).toContain("Or every floor from one to another");
    expect(out).toContain('aria-label="Remove Nia Mensah from this building"');
    expect(out).toMatch(/<button[^>]*>Remove<\/button>/);
    expect(out).toMatch(/<button[^>]*>Assign<\/button>/);
  });

  it("explains that there is nobody to assign, instead of an empty form", () => {
    const out = html(coverageBuildingView(one, [], { ambassadors: [] }));
    expect(out).toContain("There is no active ambassador to assign. Add one under People first.");
    expect(out).not.toContain("<form");
  });

  it("offers only 'all floors' for a building without floors", () => {
    const out = html(coverageBuildingView(plan("9", []), [], { ambassadors }));
    expect(out).toContain("Add floors to this building before assigning an ambassador to some of them.");
    expect(out).toMatch(/type="radio" disabled="" name="scope" value="some"/);
    expect(out).not.toContain('name="floorId"');
  });

  it("shows the refusal of a form in place, as an alert, linked to the field", () => {
    const out = renderToStaticMarkup(
      <CoverageBody
        screen={coverageBuildingView(one, [assignment({ rsn: "7001", floorIds: null })], { ambassadors })}
        actions={actions}
        initial={{ assign: { status: "refused", message: "Choose at least one floor, or choose all floors." }, remove: { [NIA]: { status: "refused", message: "That ambassador is not assigned to this building." } } }}
      />,
    );
    expect(out).toContain('<p id="assign-error" role="alert" class="hub-error">Choose at least one floor, or choose all floors.</p>');
    expect(out).toContain('aria-describedby="assign-error"');
    expect(out).toContain(`<p id="remove-error-${NIA}" role="alert" class="hub-error">That ambassador is not assigned to this building.</p>`);
  });

  it("answers a building that is not there with a message and the way back", () => {
    const out = html(coverageMissingView());
    expect(out).toContain('<p role="alert">That building does not exist.</p>');
    expect(out).toContain('href="/staff/coverage"');
  });
});

describe("Coverage: the notice after a saved change", () => {
  it("is read back from the two known words only", () => {
    expect(savedNotice({ done: "assigned" })).toBe("Assignment saved.");
    expect(savedNotice({ done: "removed" })).toBe("Assignment removed.");
    expect(savedNotice({ done: ["removed", "assigned"] })).toBe("Assignment removed.");
    expect(savedNotice({ done: "<script>" })).toBeUndefined();
    expect(savedNotice({})).toBeUndefined();
  });
});
