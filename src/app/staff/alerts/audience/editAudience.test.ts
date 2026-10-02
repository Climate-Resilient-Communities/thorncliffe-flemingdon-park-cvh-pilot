import { describe, expect, it, vi } from "vitest";
import type { AlertRefusal, PlaceChoice } from "@/modules/alerting";
import { placeChoiceFromForm, refusalMessage, saveGroupsFromForm, savePlaceFromForm, type AudienceDeps } from "./editAudience";

const form = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const FLOOR_A = "01900000-0000-7000-8000-000000000f01";
const FLOOR_B = "01900000-0000-7000-8000-000000000f02";
const refs: [string, string][] = [
  ["alert", ALERT],
  ["entry", ENTRY],
];
const session = { staffId: "01900000-0000-7000-8000-0000000000c1", aal: "aal2" as const };

const message = (state: ReturnType<typeof placeChoiceFromForm>) => (state.ok ? null : state.state.status === "refused" ? state.state.message : null);

describe("the place picker's form", () => {
  it("reads a whole neighbourhood", () => {
    expect(placeChoiceFromForm(form([["scope", "neighbourhood"], ["neighbourhood", "TP"], ["neighbourhood", "FP"]]))).toEqual({
      ok: true,
      choice: { scope: "neighbourhood", neighbourhoodIds: ["TP", "FP"] },
    });
  });

  it("reads buildings: the whole building, and another with floors ticked and a range", () => {
    const parsed = placeChoiceFromForm(
      form([
        ["scope", "buildings"],
        ["building", "4154146"],
        ["building", "4154159"],
        ["floors-4154146", "all"],
        ["floors-4154159", "some"],
        ["floor-4154159", FLOOR_A],
        ["from-4154159", FLOOR_A],
        ["to-4154159", FLOOR_B],
        // The radio of every building is in the form, ticked or not.
        ["floors-4154175", "all"],
      ]),
    );
    expect(parsed).toEqual({
      ok: true,
      choice: {
        scope: "buildings",
        buildings: [
          { rsn: "4154146", floors: null },
          { rsn: "4154159", floors: { ids: [FLOOR_A], ranges: [{ from: FLOOR_A, to: FLOOR_B }] } },
        ],
      } satisfies PlaceChoice,
    });
  });

  it("passes a range with only one end to the use case, which refuses it with its own reason", () => {
    const parsed = placeChoiceFromForm(form([["scope", "buildings"], ["building", "4154146"], ["floors-4154146", "some"], ["from-4154146", FLOOR_A]]));
    expect(parsed).toEqual({ ok: true, choice: { scope: "buildings", buildings: [{ rsn: "4154146", floors: { ids: [], ranges: [{ from: FLOOR_A, to: "" }] } }] } });
  });

  it("refuses, with the reason, what would drop a choice silently", () => {
    expect(message(placeChoiceFromForm(form([])))).toBe("Choose a neighbourhood or some buildings.");
    expect(message(placeChoiceFromForm(form([["scope", "city"]])))).toBe("Choose a neighbourhood or some buildings.");
    expect(message(placeChoiceFromForm(form([["scope", "neighbourhood"], ["neighbourhood", "TP"], ["building", "4154146"]])))).toBe(
      "You chose a neighbourhood and also ticked buildings. Choose one or the other.",
    );
    expect(message(placeChoiceFromForm(form([["scope", "buildings"], ["building", "4154146"], ["neighbourhood", "TP"]])))).toBe(
      "You chose a neighbourhood and also ticked buildings. Choose one or the other.",
    );
    expect(message(placeChoiceFromForm(form([["scope", "buildings"], ["building", "4154146"], ["floors-4154146", "all"], ["floor-4154146", FLOOR_A]])))).toMatch(
      /^You chose a whole building but also picked floors or a range/,
    );
    expect(message(placeChoiceFromForm(form([["scope", "buildings"], ["building", "4154146"], ["floors-4154146", "all"], ["from-4154146", FLOOR_A], ["to-4154146", FLOOR_B]])))).toMatch(
      /^You chose a whole building but also picked/,
    );
    expect(message(placeChoiceFromForm(form([["scope", "buildings"], ["building", "4154146"], ["floor-4154159", FLOOR_A]])))).toBe(
      "You picked floors in a building that is not ticked. Tick the building, or clear its floors.",
    );
  });

  it("an empty selection reaches the use case as nothing chosen, and a malformed building number is not a building", () => {
    expect(placeChoiceFromForm(form([["scope", "neighbourhood"]]))).toEqual({ ok: true, choice: { scope: "neighbourhood", neighbourhoodIds: [] } });
    expect(placeChoiceFromForm(form([["scope", "buildings"], ["building", "not-a-number"]]))).toEqual({ ok: true, choice: { scope: "buildings", buildings: [] } });
  });
});

describe("saving", () => {
  const fake = (result: { ok: true } | { ok: false; error: AlertRefusal }) => {
    const chooseAudiencePlace = vi.fn(async () => (result.ok ? { ok: true as const, value: {} as never } : result));
    const chooseAudienceGroups = vi.fn(async () => (result.ok ? { ok: true as const, value: {} as never } : result));
    const deps: AudienceDeps = { alerting: () => ({ chooseAudiencePlace, chooseAudienceGroups }) };
    return { deps, chooseAudiencePlace, chooseAudienceGroups };
  };

  it("sends the place to the use case as the signed-in person and goes on to the groups with the draft in the query", async () => {
    const { deps, chooseAudiencePlace } = fake({ ok: true });
    const state = await savePlaceFromForm(deps, session, form([...refs, ["scope", "neighbourhood"], ["neighbourhood", "TP"]]));
    expect(chooseAudiencePlace).toHaveBeenCalledWith({ staffId: session.staffId, aal: "aal2" }, { alertId: ALERT, entryId: ENTRY }, { scope: "neighbourhood", neighbourhoodIds: ["TP"] });
    expect(state).toEqual({ status: "saved", location: `/staff/alerts/audience/groups?alert=${ALERT}&entry=${ENTRY}&done=place` });
  });

  it("does not call the use case for a form it cannot read", async () => {
    const { deps, chooseAudiencePlace } = fake({ ok: true });
    expect(await savePlaceFromForm(deps, session, form(refs))).toEqual({ status: "refused", message: "Choose a neighbourhood or some buildings." });
    expect(chooseAudiencePlace).not.toHaveBeenCalled();
  });

  it("saves the groups ticked, or none", async () => {
    const { deps, chooseAudienceGroups } = fake({ ok: true });
    expect(await saveGroupsFromForm(deps, session, form([...refs, ["group", "seniors"], ["group", "families"]]))).toEqual({
      status: "saved",
      location: `/staff/alerts/audience/groups?alert=${ALERT}&entry=${ENTRY}&done=groups`,
    });
    expect(chooseAudienceGroups).toHaveBeenLastCalledWith({ staffId: session.staffId, aal: "aal2" }, { alertId: ALERT, entryId: ENTRY }, ["seniors", "families"]);
    await saveGroupsFromForm(deps, session, form(refs));
    expect(chooseAudienceGroups).toHaveBeenLastCalledWith({ staffId: session.staffId, aal: "aal2" }, { alertId: ALERT, entryId: ENTRY }, []);
  });

  it.each([
    ["AUDIENCE_EMPTY", "Nothing is chosen. Choose at least one neighbourhood, one building, or for a building its whole building or at least one floor."],
    ["FLOOR_NOT_IN_BUILDING", "One of those floors is not a floor of that building. Reload the page and choose again."],
    ["FLOOR_RANGE_REVERSED", "A range goes from a higher floor to a lower one. Put the lower floor first."],
    ["FLOOR_RANGE_INCOMPLETE", "Choose both ends of the range of floors, or neither."],
    ["BUILDING_NOT_FOUND", "One of those buildings does not exist. Reload the page."],
    ["GROUP_UNKNOWN", "One of those groups does not exist. Reload the page."],
    ["NEIGHBOURHOOD_ONLY_TYPE", "Heat, smoke and winter storm alerts go to a whole neighbourhood, not to buildings. Choose a neighbourhood."],
    ["NOT_ALLOWED", "Only a Coordinator or an Admin can choose a neighbourhood, or send a heat, smoke or winter storm alert."],
    ["OUT_OF_SCOPE", "You are not assigned to one of those buildings."],
    ["ENTRY_NOT_FOUND", "That alert draft was not found."],
    ["ILLEGAL_TRANSITION", "This alert was already submitted, so who it is for cannot change."],
    ["ALERT_CLOSED", "This alert is closed."],
    ["TEXT_EMPTY", "That audience cannot be used. Reload the page and choose again."],
  ] as const)("tells the person why: %s", async (error, expected) => {
    expect(refusalMessage(error)).toBe(expected);
    const { deps } = fake({ ok: false, error });
    expect(await savePlaceFromForm(deps, session, form([...refs, ["scope", "neighbourhood"], ["neighbourhood", "TP"]]))).toEqual({ status: "refused", message: expected });
  });
});
