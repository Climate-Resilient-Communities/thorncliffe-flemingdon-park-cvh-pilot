// What the coverage screen shows (S01.14): the view models for the list of buildings and for one building,
// with every text already resolved from the English catalog, so the components that draw them know none of it.
// Covered and uncovered floors are always written out; colour only adds to the words.
import { englishText } from "@/i18n/text";
import { floorCoverage, type AmbassadorOption, type AssignmentView } from "@/modules/identity";
import type { BuildingFloorPlan } from "@/modules/places";

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.coverage.${key}`, values);

export const COVERAGE_PAGE = "/staff/coverage";

export interface CoverageItemView {
  rsn: string;
  address: string;
  href: string;
  /** "Coverage of 4 Milepost Pl", the link's accessible name. */
  linkLabel: string;
  /** "Floors covered: 3 of 5.", "Every floor is covered.", "No floors are listed for this building yet." */
  summary: string;
  /** The covered floors, written out ("G, 1, 2"), when there are any. */
  covered?: { label: string; floors: string };
  /** The floors without an ambassador, written out, when there are any. */
  uncovered?: { label: string; floors: string };
}

export interface CoverageListView {
  kind: "list";
  title: string;
  lead: string;
  summary: string;
  notice?: string;
  empty?: string;
  groups: { id: string; name: string; items: CoverageItemView[] }[];
}

export interface FloorStateView {
  id: string;
  label: string;
  covered: boolean;
  /** "Covered by Ann Okafor, Bo Kim" or "Not covered". */
  state: string;
  /** "Floor 3: Not covered", the item's accessible name. */
  name: string;
}

export interface AssignmentRowView {
  staffId: string;
  /** "Ann Okafor". */
  name: string;
  /** "All floors" or "Floors G, 1, 2". */
  floors: string;
  /** Set when the person does not cover now: "Not covering now: the account is suspended." */
  inactive?: string;
  remove: string;
  removeName: string;
}

export interface AssignFormView {
  title: string;
  person: string;
  choose: string;
  /** Set instead of the form when there is nobody active to assign. */
  noAmbassadors?: string;
  ambassadors: { id: string; name: string }[];
  scope: string;
  all: string;
  some: string;
  pick: string;
  range: string;
  from: string;
  to: string;
  none: string;
  submit: string;
  floors: { id: string; label: string }[];
  /** Set when the building has no floors: only "all floors" can be assigned. */
  noFloors?: string;
}

export interface CoverageBuildingView {
  kind: "building";
  rsn: string;
  address: string;
  neighbourhood: string;
  notice?: string;
  back: { href: string; label: string };
  summary: string;
  floors: { title: string; empty?: string; rows: FloorStateView[] };
  assignments: { title: string; empty?: string; rows: AssignmentRowView[] };
  /** Only for someone who may assign (an Admin): a Coordinator and a Director see the coverage, read-only. */
  assign?: AssignFormView;
}

export interface CoverageMissingView {
  kind: "missing";
  message: string;
  back: { href: string; label: string };
}

export type CoverageScreen = CoverageListView | CoverageBuildingView | CoverageMissingView;

/** The query of a page shown after a saved change. */
export interface SavedQuery {
  done?: string | string[];
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** What the page tells the person about the change they just saved; only the two known words are read back. */
export function savedNotice(query: SavedQuery): string | undefined {
  switch (first(query.done)) {
    case "assigned":
      return t("saved.assigned");
    case "removed":
      return t("saved.removed");
    default:
      return undefined;
  }
}

const personName = (person: { firstName: string; lastName: string }) => `${person.firstName} ${person.lastName}`;

/** The assignments of one building that count: an active Ambassador's. */
const coveringIn = (rsn: string, assignments: readonly AssignmentView[]) => assignments.filter((assignment) => assignment.rsn === rsn && assignment.covering);

function summaryOf(total: number, covered: number): string {
  if (total === 0) return t("noFloors");
  if (covered === total) return t("allCovered");
  if (covered === 0) return t("noneCovered");
  return t("floorsCovered", { covered, total });
}

export function coverageListView(plans: readonly BuildingFloorPlan[], assignments: readonly AssignmentView[], notice?: string): CoverageListView {
  const groups = new Map<string, CoverageListView["groups"][number]>();
  let complete = 0;
  let gaps = 0;
  for (const plan of plans) {
    const coverage = floorCoverage(plan.floors, coveringIn(plan.rsn, assignments));
    const labelOf = new Map(plan.floors.map((floor) => [floor.id, floor.label]));
    const coveredLabels = coverage.filter((floor) => floor.covered).map((floor) => labelOf.get(floor.floorId) ?? "");
    const uncoveredLabels = coverage.filter((floor) => !floor.covered).map((floor) => labelOf.get(floor.floorId) ?? "");
    if (plan.floors.length > 0 && uncoveredLabels.length === 0) complete += 1;
    gaps += uncoveredLabels.length;
    const group = groups.get(plan.neighbourhoodId) ?? { id: plan.neighbourhoodId, name: plan.neighbourhoodName, items: [] };
    group.items.push({
      rsn: plan.rsn,
      address: plan.address,
      href: `${COVERAGE_PAGE}?building=${plan.rsn}`,
      linkLabel: t("viewOf", { address: plan.address }),
      summary: summaryOf(plan.floors.length, coveredLabels.length),
      ...(coveredLabels.length > 0 ? { covered: { label: t("coveredLabel"), floors: coveredLabels.join(", ") } } : {}),
      ...(uncoveredLabels.length > 0 ? { uncovered: { label: t("notCoveredLabel"), floors: uncoveredLabels.join(", ") } } : {}),
    });
    groups.set(plan.neighbourhoodId, group);
  }
  return {
    kind: "list",
    title: t("title"),
    lead: t("lead"),
    summary: t("summary", { covered: complete, total: plans.length, gaps }),
    ...(notice ? { notice } : {}),
    ...(plans.length === 0 ? { empty: t("empty") } : {}),
    groups: [...groups.values()],
  };
}

const INACTIVE_REASON: Record<string, string> = {
  locked_pending_reissue: "inactive.locked_pending_reissue",
  suspended: "inactive.suspended",
  removed: "inactive.removed",
};

function inactiveReason(assignment: AssignmentView): string {
  // A role other than Ambassador is the reason whatever the status says.
  if (assignment.role !== "ambassador") return t("inactive.notAmbassador");
  return t(INACTIVE_REASON[assignment.status] ?? "inactive.suspended");
}

export function coverageBuildingView(
  plan: BuildingFloorPlan,
  assignments: readonly AssignmentView[],
  options: { notice?: string; ambassadors?: readonly AmbassadorOption[] } = {},
): CoverageBuildingView {
  const here = assignments.filter((assignment) => assignment.rsn === plan.rsn);
  const covering = here.filter((assignment) => assignment.covering);
  const namesOf = new Map(here.map((assignment) => [assignment.staffId, personName(assignment)]));
  const labelOf = new Map(plan.floors.map((floor) => [floor.id, floor.label]));
  const coverage = floorCoverage(plan.floors, covering);
  return {
    kind: "building",
    rsn: plan.rsn,
    address: plan.address,
    neighbourhood: plan.neighbourhoodName,
    ...(options.notice ? { notice: options.notice } : {}),
    back: { href: COVERAGE_PAGE, label: t("back") },
    summary: summaryOf(plan.floors.length, coverage.filter((floor) => floor.covered).length),
    floors: {
      title: t("floorsTitle"),
      ...(plan.floors.length === 0 ? { empty: t("noFloors") } : {}),
      rows: coverage.map((floor) => {
        const label = labelOf.get(floor.floorId) ?? "";
        const state = floor.covered ? t("coveredBy", { names: floor.staffIds.map((id) => namesOf.get(id) ?? "").join(", ") }) : t("notCovered");
        return { id: floor.floorId, label, covered: floor.covered, state, name: t("floorState", { label, state }) };
      }),
    },
    assignments: {
      title: t("assignmentsTitle"),
      ...(here.length === 0 ? { empty: t("noAssignments") } : {}),
      rows: here.map((assignment) => ({
        staffId: assignment.staffId,
        name: personName(assignment),
        // The listed floors in the building's own order, lowest first, whatever order the reader gave them in.
        floors:
          assignment.floorIds === null
            ? t("allFloors")
            : t("someFloors", { labels: plan.floors.filter((floor) => assignment.floorIds?.includes(floor.id)).map((floor) => floor.label).join(", ") }),
        ...(assignment.covering ? {} : { inactive: t("notCoveringNow", { reason: inactiveReason(assignment) }) }),
        remove: t("remove"),
        removeName: t("removeOf", { name: personName(assignment) }),
      })),
    },
    ...(options.ambassadors
      ? {
          assign: {
            title: t("assign.title"),
            person: t("assign.person"),
            choose: t("assign.choose"),
            ...(options.ambassadors.length === 0 ? { noAmbassadors: t("assign.noAmbassadors") } : {}),
            ambassadors: options.ambassadors.map((person) => ({ id: person.staffId, name: personName(person) })),
            scope: t("assign.scope"),
            all: t("assign.all"),
            some: t("assign.some"),
            pick: t("assign.pick"),
            range: t("assign.range"),
            from: t("assign.from"),
            to: t("assign.to"),
            none: t("assign.none"),
            submit: t("assign.submit"),
            floors: plan.floors.map((floor) => ({ id: floor.id, label: floor.label })),
            ...(plan.floors.length === 0 ? { noFloors: t("assign.noFloors") } : {}),
          },
        }
      : {}),
  };
}

export function coverageMissingView(): CoverageMissingView {
  return { kind: "missing", message: t("errors.buildingNotFound"), back: { href: COVERAGE_PAGE, label: t("back") } };
}
