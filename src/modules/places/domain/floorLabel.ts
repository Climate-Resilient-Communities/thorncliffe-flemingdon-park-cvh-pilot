/**
 * Floor labels (S01.13): what an Admin may call a floor. The register gives only a number of
 * storeys, so the Hub names the floors: no 13, "G" for the ground floor, "L" for the lobby, "P1"
 * for a parking level.
 *
 * A label is 1 to 8 characters: letters (a to z, either case), digits, spaces and hyphens. Spaces
 * at either end are dropped before anything is checked, so "  G " is "G" and a label of only
 * spaces is empty. Two labels of one building are the same when they are equal ignoring case and
 * spaces ("G" and "g", "1 A" and "1A"). Hyphens count: "1-2" and "12" differ. Letters are the
 * ASCII ones, the same rule the audit trail's schema states for a floor label (S01.04).
 */

export const FLOOR_LABEL_MAX_LENGTH = 8;

const ALLOWED = /^[A-Za-z0-9 -]+$/;

/** Why a label is refused, in the order the checks run. */
export type FloorLabelError = "label_empty" | "label_too_long" | "label_characters" | "label_duplicate";

export type FloorLabelCheck = { ok: true; label: string } | { ok: false; error: FloorLabelError };

/** The label as it is stored: white space at either end dropped. */
export const trimFloorLabel = (input: string): string => input.trim();

/** What "the same label" means within a building: lower case, no spaces. */
export const floorLabelKey = (label: string): string => label.toLowerCase().replaceAll(" ", "");

/**
 * Checks a label against the rules and against the other labels of the building (`others`: the
 * labels of every floor except the one being renamed). Returns the label to store, or the first
 * reason it is refused.
 */
export function checkFloorLabel(input: string, others: readonly string[]): FloorLabelCheck {
  const label = trimFloorLabel(input);
  if (label === "") return { ok: false, error: "label_empty" };
  if (label.length > FLOOR_LABEL_MAX_LENGTH) return { ok: false, error: "label_too_long" };
  if (!ALLOWED.test(label)) return { ok: false, error: "label_characters" };
  const key = floorLabelKey(label);
  if (others.some((other) => floorLabelKey(other) === key)) return { ok: false, error: "label_duplicate" };
  return { ok: true, label };
}
