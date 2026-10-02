// What the audience pages show (S04.04, O-03 the place and O-04 the groups): the view models, with every text
// already resolved from the English catalog, so the components that draw them know none of it. The words come
// through a `text` function (the catalog by default) so the layout tests can put the longest translated labels
// of a language in every place without changing a component.
import { AUDIENCE_GROUPS, type Audience } from "@/contracts/audience";
import { englishText } from "@/i18n/text";
import type { BuildingFloorPlan } from "@/modules/places";
import { GROUPS_PAGE, PLACE_PAGE, type DraftRef } from "./editAudience";

export type Text = (key: string, values?: Record<string, string | number>) => string;

/** The words of this screen: `staff.audience.<key>` of the catalog. */
export const catalogText: Text = (key, values) => englishText(`staff.audience.${key}`, values);

export interface StepsView {
  label: string;
  items: { id: "place" | "groups"; label: string; href: string; current: boolean }[];
}

/** "Who gets it now", from the saved audience: in words, never by colour. */
export interface AsideView {
  title: string;
  /** "Everyone living in Thorncliffe Park." or "Residents of 4 Milepost Pl (all floors) and …". */
  sentence: string;
  /** Said when floors were chosen: residents with no floor recorded get it too. */
  floorNote?: string;
  /** "Groups chosen: Seniors. …" or "No group chosen: …". */
  groups: string;
  link: { href: string; label: string };
}

export interface BuildingRowView {
  rsn: string;
  address: string;
  checked: boolean;
  /** The radio: whole building (true) or some floors (false). */
  whole: boolean;
  floors: { id: string; label: string; checked: boolean }[];
  /** The floors' fieldset legend ("Floors of 4 Milepost Pl"). */
  floorsLegend: string;
  /** Set instead of the floor controls when the building lists no floors. */
  noFloors?: string;
}

export interface PlaceScreen {
  kind: "place";
  title: string;
  lead: string;
  notice?: string;
  ref: DraftRef;
  steps: StepsView;
  scope: { title: string; neighbourhood: { label: string; line: string; checked: boolean }; buildings: { label: string; line: string; checked: boolean } };
  neighbourhoods: { title: string; items: { id: string; name: string; line: string; checked: boolean }[] };
  buildingsSection: { title: string; hint: string; groups: { id: string; title: string; rows: BuildingRowView[] }[] };
  floorLabels: { whole: string; some: string; pick: string; range: string; from: string; to: string; none: string };
  submit: string;
  aside: AsideView;
}

export interface GroupsScreen {
  kind: "groups";
  title: string;
  lead: string;
  notice?: string;
  ref: DraftRef;
  steps: StepsView;
  legend: string;
  hint: string;
  /** "Groups narrow who is texted. Everyone who opens the web app can still see the alert." */
  webNote: string;
  groups: { id: string; label: string; line: string; checked: boolean }[];
  submit: string;
  aside: AsideView;
}

export interface MissingScreen {
  kind: "missing";
  message: string;
  back: { href: string; label: string };
}

/** A draft that was submitted: its audience is shown and cannot change here. */
export interface LockedScreen {
  kind: "locked";
  title: string;
  message: string;
  aside: AsideView;
}

export type AudienceScreen = PlaceScreen | GroupsScreen | MissingScreen | LockedScreen;

/** The query of a page shown after a saved choice; only the two known words are read back. */
export interface SavedQuery {
  done?: string | string[];
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function savedNotice(query: SavedQuery, t: Text = catalogText): string | undefined {
  switch (first(query.done)) {
    case "place":
      return t("saved.place");
    case "groups":
      return t("saved.groups");
    default:
      return undefined;
  }
}

/** "A", "A and B", "A, B and C". */
function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const refQuery = (ref: DraftRef) => new URLSearchParams({ alert: ref.alertId, entry: ref.entryId }).toString();

function stepsOf(ref: DraftRef, current: "place" | "groups", t: Text): StepsView {
  return {
    label: t("stepsLabel"),
    items: [
      { id: "place", label: t("stepPlace"), href: `${PLACE_PAGE}?${refQuery(ref)}`, current: current === "place" },
      { id: "groups", label: t("stepGroups"), href: `${GROUPS_PAGE}?${refQuery(ref)}`, current: current === "groups" },
    ],
  };
}

/** The floors of a building by their labels, in the building's own order (lowest first), for the ids given. */
const floorLabels = (plan: BuildingFloorPlan, ids: readonly string[]) => plan.floors.filter((floor) => ids.includes(floor.id)).map((floor) => floor.label);

const groupName = (group: string, t: Text) => ((AUDIENCE_GROUPS as readonly string[]).includes(group) ? t(`groupNames.${group}`) : group);

/** The audience in words (the aside of both pages, and what the approver will read in S04.07). */
export function asideOf(audience: Audience, plans: readonly BuildingFloorPlan[], link: AsideView["link"], t: Text = catalogText): AsideView {
  let sentence: string;
  let floorNote: string | undefined;
  if (audience.scope === "neighbourhood") {
    const names = audience.neighbourhood_ids.map((id) => plans.find((plan) => plan.neighbourhoodId === id)?.neighbourhoodName ?? id);
    sentence = t("everyoneIn", { places: joinWords(names) });
  } else {
    const pieces = audience.buildings.map((chosen) => {
      const plan = plans.find((candidate) => candidate.rsn === chosen.rsn);
      const address = plan?.address ?? chosen.rsn;
      if (chosen.floors === null) return t("wholeOf", { address });
      return t("floorsOf", { address, labels: plan ? floorLabels(plan, chosen.floors).join(", ") : chosen.floors.length });
    });
    sentence = t("buildingsSentence", { places: joinWords(pieces) });
    if (audience.buildings.some((chosen) => chosen.floors !== null)) floorNote = t("noFloorNote");
  }
  const groups = audience.groups.length === 0 ? t("noGroupsChosen") : t("groupsChosen", { groups: joinWords(audience.groups.map((group) => groupName(group, t))) });
  return { title: t("whoTitle"), sentence, ...(floorNote ? { floorNote } : {}), groups, link };
}

export function placeScreen(plans: readonly BuildingFloorPlan[], audience: Audience, ref: DraftRef, options: { notice?: string; text?: Text } = {}): PlaceScreen {
  const t = options.text ?? catalogText;
  const chosen = new Map<string, string[] | null>(audience.scope === "buildings" ? audience.buildings.map((building) => [building.rsn, building.floors] as const) : []);
  const neighbourhoods = new Map<string, { id: string; name: string; count: number }>();
  const groups = new Map<string, PlaceScreen["buildingsSection"]["groups"][number]>();
  for (const plan of plans) {
    const known = neighbourhoods.get(plan.neighbourhoodId) ?? { id: plan.neighbourhoodId, name: plan.neighbourhoodName, count: 0 };
    known.count += 1;
    neighbourhoods.set(plan.neighbourhoodId, known);
    const floors = chosen.get(plan.rsn);
    const row: BuildingRowView = {
      rsn: plan.rsn,
      address: plan.address,
      checked: chosen.has(plan.rsn),
      whole: floors === null || floors === undefined,
      floors: plan.floors.map((floor) => ({ id: floor.id, label: floor.label, checked: Array.isArray(floors) && floors.includes(floor.id) })),
      floorsLegend: t("floorsGroup", { address: plan.address }),
      ...(plan.floors.length === 0 ? { noFloors: t("noFloorsListed") } : {}),
    };
    const group = groups.get(plan.neighbourhoodId) ?? { id: plan.neighbourhoodId, title: "", rows: [] };
    group.rows.push(row);
    groups.set(plan.neighbourhoodId, group);
  }
  for (const group of groups.values()) group.title = t("buildingGroup", { name: neighbourhoods.get(group.id)!.name, n: group.rows.length });
  const chosenNeighbourhoods = audience.scope === "neighbourhood" ? audience.neighbourhood_ids : [];
  return {
    kind: "place",
    title: t("placeTitle"),
    lead: t("placeLead"),
    ...(options.notice ? { notice: options.notice } : {}),
    ref,
    steps: stepsOf(ref, "place", t),
    scope: {
      title: t("scopeTitle"),
      neighbourhood: { label: t("scopeNeighbourhood"), line: t("scopeNeighbourhoodLine"), checked: audience.scope === "neighbourhood" },
      buildings: { label: t("scopeBuildings"), line: t("scopeBuildingsLine"), checked: audience.scope === "buildings" },
    },
    neighbourhoods: {
      title: t("neighbourhoodsTitle"),
      items: [...neighbourhoods.values()].map((n) => ({ id: n.id, name: n.name, line: t("neighbourhoodLine", { n: n.count }), checked: chosenNeighbourhoods.includes(n.id) })),
    },
    buildingsSection: { title: t("buildingsTitle"), hint: t("buildingsHint"), groups: [...groups.values()] },
    floorLabels: { whole: t("wholeBuilding"), some: t("someFloors"), pick: t("pickFloors"), range: t("range"), from: t("from"), to: t("to"), none: t("none") },
    submit: t("savePlace"),
    aside: asideOf(audience, plans, { href: `${GROUPS_PAGE}?${refQuery(ref)}`, label: t("toGroups") }, t),
  };
}

export function groupsScreen(plans: readonly BuildingFloorPlan[], audience: Audience, ref: DraftRef, options: { notice?: string; text?: Text } = {}): GroupsScreen {
  const t = options.text ?? catalogText;
  return {
    kind: "groups",
    title: t("groupsTitle"),
    lead: t("groupsLead"),
    ...(options.notice ? { notice: options.notice } : {}),
    ref,
    steps: stepsOf(ref, "groups", t),
    legend: t("groupsFieldset"),
    hint: t("groupsHint"),
    webNote: t("groupsWeb"),
    groups: AUDIENCE_GROUPS.map((group) => ({ id: group, label: t(`groupNames.${group}`), line: t(`groupLines.${group}`), checked: audience.groups.includes(group) })),
    submit: t("saveGroups"),
    aside: asideOf(audience, plans, { href: `${PLACE_PAGE}?${refQuery(ref)}`, label: t("toPlace") }, t),
  };
}

export function missingScreen(t: Text = catalogText): MissingScreen {
  return { kind: "missing", message: t("missing"), back: { href: "/staff", label: t("back") } };
}

export function lockedScreen(plans: readonly BuildingFloorPlan[], audience: Audience, t: Text = catalogText): LockedScreen {
  return { kind: "locked", title: t("placeTitle"), message: t("locked"), aside: asideOf(audience, plans, { href: `/staff`, label: t("back") }, t) };
}
