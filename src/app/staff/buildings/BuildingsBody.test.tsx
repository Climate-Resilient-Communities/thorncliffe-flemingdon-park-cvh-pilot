import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildingDetail, BuildingSummary } from "@/modules/places";
import { BuildingsBody, type BuildingActions } from "./BuildingsBody";
import { AddFloorForm, FloorRow } from "./FloorForms";
import { buildingView, listView, missingView, savedNotice } from "./view";

const noop = async () => ({ status: "idle" as const });
const actions: BuildingActions = { add: noop, rename: noop, remove: noop, confirm: noop };

const summary = (change: Partial<BuildingSummary> = {}): BuildingSummary => ({
  rsn: "4154146",
  address: "4 Milepost Pl",
  neighbourhoodId: "TP",
  neighbourhoodName: "Thorncliffe Park",
  storeys: 6,
  floorCount: 6,
  confirmedAt: null,
  notInRegisterSince: null,
  ...change,
});

const detail = (change: Partial<BuildingDetail> = {}): BuildingDetail => ({
  ...summary(),
  facts: { elevators: 2, emergencyPower: true, coolingRoom: null, airConditioning: "None", barrierFreeEntrance: false, updatedAt: new Date("2026-10-05T12:00:00Z") },
  floors: ["G", "1", "2", "3"].map((label, index) => ({ id: `01900000-0000-7000-8000-00000000000${index}`, label, confirmed: index > 1 })),
  ...change,
});

const html = (screen: Parameters<typeof BuildingsBody>[0]["screen"]) => renderToStaticMarkup(<BuildingsBody screen={screen} actions={actions} />);

describe("Buildings and floors: the list", () => {
  it("groups the buildings by neighbourhood, with each one's floors and whether they are confirmed, in words", () => {
    const out = html(
      listView([
        summary(),
        summary({ rsn: "4154147", address: "6 Milepost Pl", confirmedAt: new Date("2026-10-06T15:00:00Z") }),
        summary({ rsn: "4154763", address: "5 Dufresne Crt", neighbourhoodId: "FP", neighbourhoodName: "Flemingdon Park", storeys: null, floorCount: 0 }),
      ]),
    );

    expect(out).toContain("<h1>Buildings and floors</h1>");
    expect(out).toContain("Thorncliffe Park (2)");
    expect(out).toContain("Flemingdon Park (1)");
    expect(out).toContain('href="/staff/buildings?building=4154146"');
    expect(out).toContain('aria-label="Edit floors of 4 Milepost Pl"');
    expect(out).toContain("6 storeys in the register. 6 floors. Floors not confirmed yet.");
    expect(out).toContain("Storeys not known. 0 floors.");
    expect(out).toMatch(/Floors confirmed\./);
  });

  it("flags a building that is not in the latest register", () => {
    expect(html(listView([summary({ notInRegisterSince: new Date("2026-11-01T00:00:00Z") })]))).toContain('<p role="note">Not in latest register</p>');
  });

  it("says when nothing has been imported", () => {
    expect(html(listView([]))).toContain("No buildings have been imported yet. Ask IT to run the buildings seed.");
  });

  it("shows the notice after a saved change, as a status", () => {
    expect(html(listView([summary()], "Building confirmed with 6 floors."))).toContain('<p role="status">Building confirmed with 6 floors.</p>');
  });
});

describe("Buildings and floors: one building", () => {
  it("shows the facts from the register with a last-updated date, and not known where the register is silent", () => {
    const out = html(buildingView(detail()));

    expect(out).toContain("<h1>4 Milepost Pl</h1>");
    expect(out).toContain("From the City register");
    expect(out).toContain("Last updated Oct 5, 2026");
    for (const line of ["Storeys: 6", "Elevators: 2", "Emergency power: Yes", "Cooling room: Not known", "Air conditioning: None", "Barrier-free entrance: No"]) {
      expect(out).toContain(line);
    }
  });

  it("lists every floor with a label field, a Rename and a Remove, each form posting the building and the floor id", () => {
    const out = html(buildingView(detail()));

    expect(out.match(/<button[^>]*>Rename<\/button>/g)).toHaveLength(4);
    expect(out.match(/<button[^>]*>Remove<\/button>/g)).toHaveLength(4);
    expect(out).toContain('aria-label="Label of the floor now called G"');
    expect(out).toContain('name="floorId" value="01900000-0000-7000-8000-000000000001"');
    expect(out).toContain('name="rsn" value="4154146"');
    expect(out).toContain('value="G"');
    expect(out).toContain("not confirmed");
  });

  it("offers to add a floor and to mark the building confirmed, until it is", () => {
    const open = html(buildingView(detail()));
    expect(open).toContain("Add a floor");
    expect(open).toContain('<option value="top" selected="">Above the top floor</option>');
    expect(open).toContain('<option value="bottom">Below the lowest floor</option>');
    expect(open).toContain(">Mark building confirmed</button>");
    expect(open).toContain("Floors not confirmed yet.");

    const done = html(buildingView(detail({ confirmedAt: new Date("2026-10-06T15:00:00Z") })));
    expect(done).not.toContain("Mark building confirmed");
    expect(done).toContain("Floors confirmed on Oct 6, 2026.");
    expect(done).toContain("Add a floor");
  });

  it("shows the review flag of a building the register no longer lists", () => {
    const out = html(buildingView(detail({ notInRegisterSince: new Date("2026-11-01T00:00:00Z") })));
    expect(out).toContain("<strong>Not in latest register</strong>");
    expect(out).toContain("It is kept as it is. Check whether it still belongs in the pilot.");
  });

  it("says so when the building has no floors", () => {
    expect(html(buildingView(detail({ floors: [], floorCount: 0 })))).toContain("This building has no floors yet.");
  });

  it("links back to the list, and says when there is no such building", () => {
    expect(html(buildingView(detail()))).toContain('<a class="tap" href="/staff/buildings">All buildings</a>');
    const missing = html(missingView());
    expect(missing).toContain('<p role="alert">That building does not exist.</p>');
    expect(missing).toContain('href="/staff/buildings"');
  });
});

describe("a form that was refused", () => {
  const view = buildingView(detail());

  it("shows the reason in an alert and the label as it was typed, on the floor's row", () => {
    const out = renderToStaticMarkup(
      <FloorRow
        rsn="4154146"
        floor={view.floors.rows[1]}
        labels={view.floors}
        rename={noop}
        remove={noop}
        initialRename={{ status: "refused", message: "A label can have at most 8 characters.", label: "123456789" }}
      />,
    );
    expect(out).toContain('<p id="rename-error-01900000-0000-7000-8000-000000000001" role="alert">A label can have at most 8 characters.</p>');
    expect(out).toContain('value="123456789"');
    expect(out).toContain('aria-invalid="true"');
  });

  it("lists the ambassadors that block a removal", () => {
    const out = renderToStaticMarkup(
      <FloorRow
        rsn="4154146"
        floor={view.floors.rows[1]}
        labels={view.floors}
        rename={noop}
        remove={noop}
        initialRemove={{ status: "refused", message: "Reassign or remove the ambassadors on this floor first", detail: "Ambassadors on this floor: Nia Mensah, Omar Farouk" }}
      />,
    );
    expect(out).toContain('role="alert">Reassign or remove the ambassadors on this floor first</p>');
    expect(out).toContain("<p>Ambassadors on this floor: Nia Mensah, Omar Farouk</p>");
  });

  it("keeps the label and place typed in the add form", () => {
    const out = renderToStaticMarkup(
      <AddFloorForm rsn="4154146" labels={view.add} action={noop} initialState={{ status: "refused", message: "Use only letters, digits, spaces and hyphens in a label.", label: "1.5", place: "bottom" }} />,
    );
    expect(out).toContain('value="1.5"');
    expect(out).toContain('<option value="bottom" selected="">');
    expect(out).toContain('aria-describedby="add-floor-hint add-floor-error"');
  });
});

describe("the notice after a saved change", () => {
  it.each([
    [{ done: "added", label: "G" }, "Floor G added."],
    [{ done: "renamed", from: "3", to: "3A" }, "Floor 3 is now called 3A."],
    [{ done: "removed", label: "13" }, "Floor 13 removed."],
    [{ done: "confirmed", n: "14" }, "Building confirmed with 14 floors."],
  ])("reads %j", (query, text) => {
    expect(savedNotice(query)).toBe(text);
  });

  it.each([{}, { done: "added" }, { done: "added", label: "<script>" }, { done: "added", label: "123456789" }, { done: "confirmed", n: "many" }, { done: "deleted-everything" }])("shows nothing for %j", (query) => {
    expect(savedNotice(query)).toBeUndefined();
  });
});
