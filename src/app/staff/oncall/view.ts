import { englishText } from "@/i18n/text";

/** The on-call numbers page (S06.07). */
export const ONCALL_PAGE = "/staff/oncall";

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.oncall.${key}`, values);

/** How many numbers are on the list, in words ("1 on-call number", "3 on-call numbers"). */
export function countLine(n: number): string {
  return n === 1 ? t("countOne") : t("count", { n });
}

/** The line after an addition: the name that was given and the size of the list. Never the number. */
export function addedLine(label: string, size: number): string {
  return size === 1 ? t("done.addedOne", { label }) : t("done.added", { label, n: size });
}

/** The line after a removal. */
export function removedLine(label: string, size: number): string {
  if (size === 0) return t("done.removedNone", { label });
  return size === 1 ? t("done.removedOne", { label }) : t("done.removed", { label, n: size });
}

/** The line about the waiting texts a removal cancelled; null when there were none. */
export function skippedLine(skipped: number): string | null {
  if (skipped === 0) return null;
  return skipped === 1 ? t("done.skippedOne") : t("done.skipped", { n: skipped });
}
