import { englishText } from "@/i18n/text";
import type { AssignRefusal, AssignmentService, RemoveAssignmentRefusal } from "@/modules/identity";
import type { StaffSession } from "../session";
import { COVERAGE_PAGE } from "./view";

/**
 * What an assignment form shows after a submission. Every text is already resolved from the catalog. A
 * saved change sends the person back to the building (`location`), where the page shows what was done.
 */
export type AssignState =
  | { status: "idle" }
  | { status: "refused"; message: string }
  | { status: "saved"; location: string }
  /** Removing an assignment asks first: the first submit only asks, and the form then posts `confirm=1`. */
  | { status: "confirm"; message: string };

export interface AssignDeps {
  assignments: () => Pick<AssignmentService, "assign" | "remove">;
}

export const MESSAGE_KEYS: Record<AssignRefusal | RemoveAssignmentRefusal | "choose_person" | "choose_scope" | "all_with_floors", string> = {
  forbidden: "staff.coverage.errors.assignForbidden",
  building_not_found: "staff.coverage.errors.buildingNotFound",
  account_not_found: "staff.coverage.errors.accountNotFound",
  not_ambassador: "staff.coverage.errors.notAmbassador",
  account_not_active: "staff.coverage.errors.accountNotActive",
  no_floors: "staff.coverage.errors.noFloors",
  floor_not_in_building: "staff.coverage.errors.floorNotInBuilding",
  range_incomplete: "staff.coverage.errors.rangeIncomplete",
  range_reversed: "staff.coverage.errors.rangeReversed",
  not_assigned: "staff.coverage.errors.notAssigned",
  choose_person: "staff.coverage.errors.choosePerson",
  choose_scope: "staff.coverage.errors.chooseScope",
  all_with_floors: "staff.coverage.errors.allWithFloors",
};

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

const refusal = (error: keyof typeof MESSAGE_KEYS): AssignState => ({ status: "refused", message: englishText(MESSAGE_KEYS[error]) });

/** Where a saved change lands: the building's page, with what was done in the query (read back by ./view.ts). */
export function savedLocation(rsn: string, done: "assigned" | "removed"): string {
  return `${COVERAGE_PAGE}?${new URLSearchParams({ building: rsn, done }).toString()}`;
}

/**
 * "Assign": a person and the floors. The building is the one the guard judged (`rsn`), never read from
 * the form again. The scope is chosen, not assumed: `scope=all` is every floor of the building, `scope=some`
 * the floors ticked (`floorId`, one per tick) and, if both ends are chosen, every floor from one to the
 * other as the building orders them. No scope is refused, and so is "all floors" sent with floors ticked
 * or a range chosen: nothing the person picked is dropped silently.
 */
export async function assignFromForm(deps: AssignDeps, session: Pick<StaffSession, "staffId">, rsn: string, form: FormData): Promise<AssignState> {
  const staffId = text(form, "staffId");
  if (staffId === "") return refusal("choose_person");
  const scope = text(form, "scope");
  if (scope !== "all" && scope !== "some") return refusal("choose_scope");
  const all = scope === "all";
  const from = text(form, "from");
  const to = text(form, "to");
  const ticked = form.getAll("floorId").filter((value): value is string => typeof value === "string");
  if (all && (ticked.length > 0 || from !== "" || to !== "")) return refusal("all_with_floors");
  const floorIds = all ? null : ticked;
  const range = all || (from === "" && to === "") ? undefined : { from, to };
  const result = await deps.assignments().assign(session.staffId, { staffId, rsn, floorIds, ...(range ? { range } : {}) });
  return result.ok ? { status: "saved", location: savedLocation(rsn, "assigned") } : refusal(result.error);
}

/**
 * "Remove" an assignment: the person stays, they no longer cover the building. Removing is not undone by a click,
 * so the assignment goes only when the form carries `confirm=1`; the first submit changes nothing and returns the
 * question. (`name` is only the text of the question: the person is `staffId`.)
 */
export async function removeFromForm(deps: AssignDeps, session: Pick<StaffSession, "staffId">, rsn: string, form: FormData): Promise<AssignState> {
  if (text(form, "confirm") !== "1") return { status: "confirm", message: englishText("staff.coverage.removeConfirm", { name: text(form, "name").slice(0, 100) }) };
  const result = await deps.assignments().remove(session.staffId, { staffId: text(form, "staffId"), rsn });
  return result.ok ? { status: "saved", location: savedLocation(rsn, "removed") } : refusal(result.error);
}
