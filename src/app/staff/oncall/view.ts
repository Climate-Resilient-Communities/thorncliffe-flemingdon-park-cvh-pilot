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

/** An entry of the roster as the on-duty choice names it (its label; the number is never in the choice). */
export interface OnDutyEntry {
  id: string;
  label: string;
  onDuty: boolean;
  staffId: string | null;
}

/**
 * The on-duty section of the page (S08.08, E08 "On-duty Admin"): what is set now in a sentence (`set`: the entry and the Admin it belongs to; `none`;
 * `stale`: an entry whose account is no longer an active Admin with an authenticator, so escalations go to every number), and the two choices: the
 * roster's entries by label and the Admin accounts that can be on duty, by name, the current ones chosen.
 */
export interface OnDutyView {
  state: "set" | "none" | "stale";
  line: string;
  numbers: { id: string; label: string }[];
  accounts: { id: string; name: string }[];
  chosenNumber: string | null;
  chosenAccount: string | null;
}

export function onDutyView(input: {
  entries: readonly OnDutyEntry[];
  state: "set" | "none" | "stale";
  accounts: readonly { id: string; name: string }[];
  /** The name of the account the on-duty entry belongs to (null when it is gone). */
  onDutyName: string | null;
}): OnDutyView {
  const entry = input.entries.find((one) => one.onDuty) ?? null;
  const name = input.onDutyName ?? t("onDuty.someone");
  const line =
    input.state === "none" || entry === null
      ? t("onDuty.nobody")
      : input.state === "set"
        ? t("onDuty.isOnDuty", { label: entry.label, name })
        : t("onDuty.stale", { label: entry.label, name });
  return {
    state: entry === null ? "none" : input.state,
    line,
    numbers: input.entries.map((one) => ({ id: one.id, label: one.label })),
    accounts: [...input.accounts],
    chosenNumber: entry?.id ?? null,
    chosenAccount: input.state === "set" ? (entry?.staffId ?? null) : null,
  };
}

/** The line after the on-duty entry was set or ended. Never a number. */
export function onDutyDoneLine(kind: "set" | "cleared", label: string): string {
  return kind === "set" ? t("onDuty.done.set", { label }) : t("onDuty.done.cleared", { label });
}
