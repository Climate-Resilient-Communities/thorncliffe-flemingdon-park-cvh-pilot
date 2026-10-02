import { DEVICE_CHOICES_KEY, parseDeviceChoices } from "@/contracts/deviceChoices";
import type { LangCode } from "@/contracts/lang";

type ChoicesStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Saves the resident's language in device choices (`cvh.choices`, AD-3), keeping what else is saved there.
 * A missing or invalid value is replaced by a fresh `{v: 1, lang}`. Returns false when the phone refuses to
 * store it (private mode, storage blocked); the app works the same, only the choice is not remembered.
 */
export function saveLanguageChoice(storage: ChoicesStorage | undefined, lang: LangCode): boolean {
  try {
    if (!storage) return false;
    const saved = parseDeviceChoices(storage.getItem(DEVICE_CHOICES_KEY));
    storage.setItem(DEVICE_CHOICES_KEY, JSON.stringify({ ...saved, v: 1, lang }));
    return true;
  } catch {
    return false;
  }
}

/** The phone's localStorage, or undefined where reading the property itself throws. */
export function deviceStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
