import type { LangCode } from "@/contracts/lang";
import { baseChoices, choicesStore, type ChoicesStore } from "../choices/choices-store";

/**
 * Saves the resident's language in device choices (`cvh.choices`, AD-3), keeping what else is saved there. It goes
 * through the choices store like every other change, so the screens that show the choices hear it, `savedAt` is
 * stamped, and a value that is missing or invalid is replaced by a fresh `{v: 1, lang}`. Returns false when the phone
 * refuses to store it (private mode, storage blocked); the app works the same, only the choice is not remembered.
 */
export function saveLanguageChoice(lang: LangCode, store: Pick<ChoicesStore, "update"> = choicesStore): boolean {
  return store.update((current) => ({ ...baseChoices(current), lang }));
}
