import { englishText } from "@/i18n/text";
import type { AssignRefusal, AssignmentService, RemoveAssignmentRefusal } from "@/modules/identity";
import type { StaffSession } from "../session";
import { COVERAGE_PAGE } from "./view";

/**
 * What an assignment form shows after a submission. Every text is already resolved from the catalog. A
 * saved change sends the person back to the building (`location`), where the page shows what was done.
 */
export type AssignState = { status: "idle" } | { status: "refused"; message: string } | { status: "saved"; location: string };

export interface AssignDeps {
  assignments: () => Pick<AssignmentService, "assign" | "remove">;
}

export const MESSAGE_KEYS: Record<AssignRefusal | RemoveAssignmentRefusal | "choose_person", string> = {
  building_not_found: "staff.coverage.errors.buildingNotFound",
  account_not_found: "staff.coverage.errors.accountNotFound",
  not_ambassador: "staff.coverage.errors.notAmbassador",
  account_not_active: "staff.coverage.errors.accountNotActive",
  no_floors: "staff.coverage.errors.noFloors",
  floor_not_in_building: "staff.coverage.errors.floorNotInBuilding",
  range_incomplete: "staff.coverage.errors.rangeIncomplete",
  not_assigned: "staff.coverage.errors.notAssigned",
  choose_person: "staff.coverage.errors.choosePerson",
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
 * the form again. "All floors" is `scope=all`; otherwise the floors ticked (`floorId`, one per tick)
 * and, if both ends are chosen, every floor from one to the other as the building orders them.
 */
export async function assignFromForm(deps: AssignDeps, session: Pick<StaffSession, "staffId">, rsn: string, form: FormData): Promise<AssignState> {
  const staffId = text(form, "staffId");
  if (staffId === "") return refusal("choose_person");
  const all = text(form, "scope") === "all";
  const from = text(form, "from");
  const to = text(form, "to");
  const floorIds = all ? null : form.getAll("floorId").filter((value): value is string => typeof value === "string");
  const range = all || (from === "" && to === "") ? undefined : { from, to };
  const result = await deps.assignments().assign(session.staffId, { staffId, rsn, floorIds, ...(range ? { range } : {}) });
  return result.ok ? { status: "saved", location: savedLocation(rsn, "assigned") } : refusal(result.error);
}

/** "Remove" an assignment: the person stays, they no longer cover the building. */
export async function removeFromForm(deps: AssignDeps, session: Pick<StaffSession, "staffId">, rsn: string, form: FormData): Promise<AssignState> {
  const result = await deps.assignments().remove(session.staffId, { staffId: text(form, "staffId"), rsn });
  return result.ok ? { status: "saved", location: savedLocation(rsn, "removed") } : refusal(result.error);
}
