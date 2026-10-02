import { englishText } from "@/i18n/text";
import type { BuildingService, FloorPlace, FloorRefusal } from "@/modules/places";
import type { StaffSession } from "../session";

/**
 * What a floor form shows after a submission. Every text is already resolved from the catalog. A
 * saved change sends the person back to the building (`location`), where the page shows what was done.
 */
export type EditState =
  | { status: "idle" }
  | { status: "refused"; message: string; detail?: string; /** The label as it was typed, to show again. */ label?: string; place?: FloorPlace }
  | { status: "saved"; location: string }
  /** Removing is destructive: the first submit only asks, and the form then posts `confirm=1`. */
  | { status: "confirm"; message: string };

export interface EditDeps {
  buildings: () => Pick<BuildingService, "addFloor" | "renameFloor" | "removeFloor" | "confirmBuilding">;
}

export const BUILDINGS_PAGE = "/staff/buildings";

export const MESSAGE_KEYS: Record<FloorRefusal, string> = {
  label_empty: "staff.buildings.errors.labelEmpty",
  label_too_long: "staff.buildings.errors.labelTooLong",
  label_characters: "staff.buildings.errors.labelCharacters",
  label_duplicate: "staff.buildings.errors.labelDuplicate",
  building_not_found: "staff.buildings.errors.buildingNotFound",
  floor_not_found: "staff.buildings.errors.floorNotFound",
  floor_has_assignments: "staff.buildings.errors.floorHasAssignments",
  no_change: "staff.buildings.errors.noChange",
  already_confirmed: "staff.buildings.errors.alreadyConfirmed",
  no_floors: "staff.buildings.errors.noFloors",
};

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** Where a saved change lands: the building's page, with what was done in the query (read back by ./view.ts). */
export function savedLocation(rsn: string, done: Record<string, string | number>): string {
  const query = new URLSearchParams({ building: rsn, ...Object.fromEntries(Object.entries(done).map(([key, value]) => [key, String(value)])) });
  return `${BUILDINGS_PAGE}?${query.toString()}`;
}

function refusal(error: FloorRefusal, extra: { ambassadors?: readonly { name: string }[]; label?: string; place?: FloorPlace } = {}): EditState {
  const { ambassadors, label, place } = extra;
  return {
    status: "refused",
    message: englishText(MESSAGE_KEYS[error]),
    ...(ambassadors && ambassadors.length > 0 ? { detail: englishText("staff.buildings.errors.ambassadors", { names: ambassadors.map((ambassador) => ambassador.name).join(", ") }) } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(place !== undefined ? { place } : {}),
  };
}

type Session = Pick<StaffSession, "staffId">;

/** "Add a floor": the building, a label and where it goes. The places module checks the label and audits the outcome. */
export async function addFloorFromForm(deps: EditDeps, session: Session, form: FormData): Promise<EditState> {
  const rsn = text(form, "rsn");
  const place: FloorPlace = text(form, "place") === "bottom" ? "bottom" : "top";
  const label = text(form, "label");
  const result = await deps.buildings().addFloor(session.staffId, { rsn, label, place });
  return result.ok ? { status: "saved", location: savedLocation(rsn, { done: "added", label: result.value.label }) } : refusal(result.error, { label, place });
}

/** "Rename" a floor: its id and assignments stay. */
export async function renameFloorFromForm(deps: EditDeps, session: Session, form: FormData): Promise<EditState> {
  const rsn = text(form, "rsn");
  const label = text(form, "label");
  const result = await deps.buildings().renameFloor(session.staffId, { rsn, floorId: text(form, "floorId"), label });
  if (!result.ok) return refusal(result.error, { label });
  return { status: "saved", location: savedLocation(rsn, { done: "renamed", from: result.value.previousLabel, to: result.value.label }) };
}

/**
 * "Remove" a floor, unless Ambassadors are assigned to it: then they are listed. Removing cannot be
 * undone, so the floor is removed only when the form carries `confirm=1`; the first submit changes
 * nothing and returns the question. (`label` is only the text of the question: the floor is the id.)
 */
export async function removeFloorFromForm(deps: EditDeps, session: Session, form: FormData): Promise<EditState> {
  const rsn = text(form, "rsn");
  if (text(form, "confirm") !== "1") return { status: "confirm", message: englishText("staff.buildings.removeConfirm", { label: text(form, "label").slice(0, 8) }) };
  const result = await deps.buildings().removeFloor(session.staffId, { rsn, floorId: text(form, "floorId") });
  return result.ok ? { status: "saved", location: savedLocation(rsn, { done: "removed", label: result.value.label }) } : refusal(result.error, { ambassadors: result.ambassadors });
}

/** "Mark building confirmed". */
export async function confirmFromForm(deps: EditDeps, session: Session, form: FormData): Promise<EditState> {
  const rsn = text(form, "rsn");
  const result = await deps.buildings().confirmBuilding(session.staffId, { rsn });
  return result.ok ? { status: "saved", location: savedLocation(rsn, { done: "confirmed", n: result.value.floors }) } : refusal(result.error);
}
