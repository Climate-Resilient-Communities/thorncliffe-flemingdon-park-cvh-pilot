// The state of one building of the place picker (O-03), as a pure reducer so that its rules can be tested without a
// browser: what each change of a control does to the others. The form sends only what the row's state says is chosen.

/** One building's choices: ticked or not, the whole building or some floors, and the floors (ticked, or a range). */
export interface RowState {
  checked: boolean;
  /** The radio: the whole building (true) or some floors (false). */
  whole: boolean;
  /** Floor ids ticked one by one. */
  floors: ReadonlySet<string>;
  /** The ends of the range, as floor ids; "" when not chosen. */
  from: string;
  to: string;
}

export type RowEvent =
  | { type: "building"; checked: boolean }
  | { type: "whole" }
  | { type: "some" }
  | { type: "floor"; id: string; checked: boolean }
  | { type: "from" | "to"; value: string };

/** Where a row starts: from the saved audience. A building with no floors listed can only be whole. */
export function initialRow(row: { checked: boolean; whole: boolean; floors: readonly { id: string; checked: boolean }[] }): RowState {
  return { checked: row.checked, whole: row.whole || row.floors.length === 0, floors: new Set(row.floors.filter((floor) => floor.checked).map((floor) => floor.id)), from: "", to: "" };
}

/**
 * What a change does:
 *  - "Whole building" clears the ticked floors and the range, so they are not sent with it (the server refuses a whole
 *    building that also names floors, rather than guess which the person meant);
 *  - ticking a floor, or choosing an end of the range, of a building that is not ticked ticks the building and switches
 *    to "some floors": a person who picks a floor means that building and those floors.
 */
export function rowReducer(state: RowState, event: RowEvent): RowState {
  switch (event.type) {
    case "building":
      return { ...state, checked: event.checked };
    case "whole":
      return { ...state, whole: true, floors: new Set(), from: "", to: "" };
    case "some":
      return { ...state, whole: false };
    case "floor": {
      const floors = new Set(state.floors);
      if (event.checked) floors.add(event.id);
      else floors.delete(event.id);
      return event.checked ? { ...state, floors, checked: true, whole: false } : { ...state, floors };
    }
    case "from":
    case "to":
      return event.value === "" ? { ...state, [event.type]: "" } : { ...state, [event.type]: event.value, checked: true, whole: false };
  }
}

/**
 * Whether the floor controls (the floors and the range) take part in the form: only for a ticked building with some floors
 * chosen. Otherwise they are disabled, and a disabled control is not sent, so nothing hidden is ever submitted.
 */
export const floorControlsEnabled = (state: RowState): boolean => state.checked && !state.whole;
