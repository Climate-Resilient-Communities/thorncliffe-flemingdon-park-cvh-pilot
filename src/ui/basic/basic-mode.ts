import { DEVICE_CHOICES_KEY } from "@/contracts/deviceChoices";
import {
  baseChoices,
  choicesStore,
  type ChoicesSnapshot,
  type ChoicesStore,
} from "../choices/choices-store";

/** The attribute on <html> that basic mode (X-07) is: tokens.generated.css, the tap rule, the grid and the shell read `:root[data-basic="true"]`. */
export const BASIC_ATTRIBUTE = "data-basic";

/** Whether the saved choices say basic mode is on. Only an explicit `true` counts. */
export const isBasic = (choices: ChoicesSnapshot | undefined): boolean =>
  choices?.basic === true;

/**
 * Runs in <head> before the first paint (S02.14): reads `cvh.choices` and sets `<html data-basic="true">`, so the page
 * never shows in normal size first. It reads the same way parseDeviceChoices does for this one field: the value must be
 * JSON, an object, version 1, with `basic` exactly true; anything else (no storage, a throwing storage, bad JSON) leaves
 * the page in normal mode. It is a string because it runs before React; basic-mode.test.ts runs it against parseDeviceChoices.
 */
export const BASIC_BOOT_SCRIPT = `try{var c=JSON.parse(localStorage.getItem(${JSON.stringify(DEVICE_CHOICES_KEY)})||"null");if(c&&typeof c==="object"&&c.v===1&&c.basic===true)document.documentElement.setAttribute(${JSON.stringify(BASIC_ATTRIBUTE)},"true");if(c&&c.v===1&&(c.textSize==="standard"||c.textSize==="large"))document.documentElement.setAttribute("data-text-size",c.textSize)}catch(e){}`;

/** Sets or removes the attribute on an element (the document's root). */
export function applyBasic(
  root: Pick<Element, "setAttribute" | "removeAttribute">,
  on: boolean,
): void {
  if (on) root.setAttribute(BASIC_ATTRIBUTE, "true");
  else root.removeAttribute(BASIC_ATTRIBUTE);
}

/**
 * Turns basic mode on or off in device choices, keeping what else is saved there (it goes through the choices store like
 * every other change, so nothing is sent anywhere). Off removes the field. Returns false when the phone refuses to
 * keep it: the mode then lasts for this open session only.
 */
export function saveBasicChoice(
  on: boolean,
  store: Pick<ChoicesStore, "update" | "getSnapshot"> = choicesStore,
): boolean {
  return store.update((current) => {
    if (isBasic(current) === on) return current;
    const next = { ...baseChoices(current), textSize: isLargeText(current) ? "large" as const : "standard" as const };
    if (on) return { ...next, basic: true };
    const { basic: _basic, ...rest } = next;
    return rest;
  });
}

export const isLargeText = (choices: ChoicesSnapshot | undefined): boolean =>
  choices?.textSize === "large" || (choices?.textSize === undefined && isBasic(choices));

export function saveDisplayChoice(change: { textSize?: "standard" | "large"; basic?: boolean }, store: Pick<ChoicesStore, "update" | "getSnapshot"> = choicesStore): boolean {
  return store.update(current => {
    const next = { ...baseChoices(current), textSize: isLargeText(current) ? "large" as const : "standard" as const, ...change };
    if (next.basic === false) delete next.basic;
    return next;
  });
}
