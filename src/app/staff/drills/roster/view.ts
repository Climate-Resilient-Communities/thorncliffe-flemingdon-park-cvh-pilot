import { englishText } from "@/i18n/text";
import { LANG_CODES, type LangCode } from "@/contracts/lang";
import { languageName } from "../view";

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.drillRoster.${key}`, values);

/** How many phones are on the roster, in words ("1 phone on the roster", "3 phones on the roster"). */
export function countLine(n: number): string {
  return n === 1 ? t("countOne") : t("count", { n });
}

/** The line after an addition: the name that was given and the size of the roster. Never the number. */
export function addedLine(label: string, size: number): string {
  return size === 1 ? t("done.addedOne", { label }) : t("done.added", { label, n: size });
}

/** The line after a change. */
export function editedLine(label: string): string {
  return t("done.edited", { label });
}

/** The line after a removal. */
export function removedLine(label: string, size: number): string {
  if (size === 0) return t("done.removedNone", { label });
  return size === 1 ? t("done.removedOne", { label }) : t("done.removed", { label, n: size });
}

/** The line about the waiting drill texts a removal cancelled; null when there were none. */
export function skippedLine(skipped: number): string | null {
  if (skipped === 0) return null;
  return skipped === 1 ? t("done.skippedOne") : t("done.skipped", { n: skipped });
}

export interface LanguageChoice {
  code: LangCode;
  name: string;
}

/** The languages a roster member can be texted in: every language code, English first, each named in English. */
export function languageChoices(): LanguageChoice[] {
  const codes = ["en", ...LANG_CODES.filter((code) => code !== "en")] as LangCode[];
  return codes.map((code) => ({ code, name: languageName(code) }));
}
