import { RsnSchema } from "@/contracts/places";
import { englishText } from "@/i18n/text";
import type { AlertLifecycle, AlertRefusal, BuildingChoice, PlaceChoice } from "@/modules/alerting";
import type { StaffSession } from "../../session";

/**
 * What an audience form shows after a submission (O-03, O-04). Every text is already resolved from the
 * catalog. A saved choice sends the person on (`location`), where the page shows what was done.
 */
export type AudienceState = { status: "idle" } | { status: "refused"; message: string } | { status: "saved"; location: string };

export interface AudienceDeps {
  alerting: () => Pick<AlertLifecycle, "chooseAudiencePlace" | "chooseAudienceGroups">;
}

export const PLACE_PAGE = "/staff/alerts/audience";
export const GROUPS_PAGE = "/staff/alerts/audience/groups";

/** The alert draft a page or form is about: both ids come from the query or a hidden field and are judged by the use case. */
export interface DraftRef {
  alertId: string;
  entryId: string;
}

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.audience.${key}`, values);

const ERROR_KEYS: Partial<Record<AlertRefusal, string>> = {
  AUDIENCE_EMPTY: "empty",
  NEIGHBOURHOOD_NOT_FOUND: "neighbourhoodNotFound",
  BUILDING_NOT_FOUND: "buildingNotFound",
  FLOOR_NOT_IN_BUILDING: "floorNotInBuilding",
  FLOOR_RANGE_REVERSED: "rangeReversed",
  FLOOR_RANGE_INCOMPLETE: "rangeIncomplete",
  GROUP_UNKNOWN: "groupUnknown",
  NEIGHBOURHOOD_ONLY_TYPE: "neighbourhoodOnlyType",
  NOT_ALLOWED: "notAllowed",
  AUTHOR_NOT_ALLOWED: "notAllowed",
  OUT_OF_SCOPE: "outOfScope",
  ALERT_NOT_FOUND: "notFound",
  ENTRY_NOT_FOUND: "notFound",
  ILLEGAL_TRANSITION: "notDraft",
  WEB_PUBLISHED: "notDraft",
  ALERT_CLOSED: "closed",
};

/** The message for a refusal of the use case, with the reason; anything else is the general "cannot be used". */
export function refusalMessage(error: AlertRefusal): string {
  return t(`errors.${ERROR_KEYS[error] ?? "invalid"}`);
}

const refused = (key: string): AudienceState => ({ status: "refused", message: t(`errors.${key}`) });

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};
const texts = (form: FormData, name: string) => form.getAll(name).filter((value): value is string => typeof value === "string" && value !== "");


/** Where a saved choice lands: the next page, with what was done in the query (read back by ./view.ts). */
export function savedLocation(page: "place" | "groups", ref: DraftRef): string {
  return `${GROUPS_PAGE}?${new URLSearchParams({ alert: ref.alertId, entry: ref.entryId, done: page }).toString()}`;
}

/**
 * What the place picker sent, as the use case takes it, or the reason it cannot be. The scope is chosen, not
 * assumed. Nothing the person picked is dropped silently: a neighbourhood together with buildings, floors or a
 * range together with "whole building", and floors picked in a building that is not ticked are each refused
 * with a message. Field names: `scope`, `neighbourhood` (one per tick), `building` (one per tick), and for a
 * building `floors-<rsn>` (`all` or `some`), `floor-<rsn>` (one per tick), `from-<rsn>` and `to-<rsn>`.
 */
export function placeChoiceFromForm(form: FormData): { ok: true; choice: PlaceChoice } | { ok: false; state: AudienceState } {
  const scope = text(form, "scope");
  if (scope !== "neighbourhood" && scope !== "buildings") return { ok: false, state: refused("chooseScope") };
  const neighbourhoods = [...new Set(texts(form, "neighbourhood"))];
  const buildings = [...new Set(texts(form, "building"))].filter((rsn) => RsnSchema.safeParse(rsn).success);
  if (scope === "neighbourhood") {
    if (buildings.length > 0) return { ok: false, state: refused("bothScopes") };
    return { ok: true, choice: { scope, neighbourhoodIds: neighbourhoods } };
  }
  if (neighbourhoods.length > 0) return { ok: false, state: refused("bothScopes") };
  // Floors given for a building that is not ticked would be lost: say so.
  const named = new Set<string>();
  for (const [name, value] of form.entries()) {
    const match = /^(?:floor|from|to)-([0-9]{1,9})$/.exec(name);
    if (match && typeof value === "string" && value !== "") named.add(match[1]);
  }
  if ([...named].some((rsn) => !buildings.includes(rsn))) return { ok: false, state: refused("floorsWithoutBuilding") };
  const chosen: BuildingChoice[] = [];
  for (const rsn of buildings) {
    const mode = text(form, `floors-${rsn}`);
    const ids = texts(form, `floor-${rsn}`);
    const from = text(form, `from-${rsn}`);
    const to = text(form, `to-${rsn}`);
    const anyFloors = ids.length > 0 || from !== "" || to !== "";
    if (mode !== "some") {
      if (anyFloors) return { ok: false, state: refused("allWithFloors") };
      chosen.push({ rsn, floors: null });
    } else {
      chosen.push({ rsn, floors: { ids, ranges: from === "" && to === "" ? [] : [{ from, to }] } });
    }
  }
  return { ok: true, choice: { scope, buildings: chosen } };
}

export function draftRefOf(form: FormData): DraftRef {
  return { alertId: text(form, "alert"), entryId: text(form, "entry") };
}

/** "Save the place": the choice, judged by the use case in its own transaction; a saved place goes on to the groups. */
export async function savePlaceFromForm(deps: AudienceDeps, session: Pick<StaffSession, "staffId" | "aal">, form: FormData): Promise<AudienceState> {
  const parsed = placeChoiceFromForm(form);
  if (!parsed.ok) return parsed.state;
  const ref = draftRefOf(form);
  const result = await deps.alerting().chooseAudiencePlace({ staffId: session.staffId, aal: session.aal }, ref, parsed.choice);
  return result.ok ? { status: "saved", location: savedLocation("place", ref) } : { status: "refused", message: refusalMessage(result.error) };
}

/** "Save the groups": any number of the groups offered, or none. */
export async function saveGroupsFromForm(deps: AudienceDeps, session: Pick<StaffSession, "staffId" | "aal">, form: FormData): Promise<AudienceState> {
  const ref = draftRefOf(form);
  const result = await deps.alerting().chooseAudienceGroups({ staffId: session.staffId, aal: session.aal }, ref, texts(form, "group"));
  return result.ok ? { status: "saved", location: savedLocation("groups", ref) } : { status: "refused", message: refusalMessage(result.error) };
}
