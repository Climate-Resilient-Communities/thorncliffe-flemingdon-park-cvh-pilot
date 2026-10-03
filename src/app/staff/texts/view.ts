import { englishText } from "@/i18n/text";
import type { PausedStatus } from "@/modules/messaging";

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.texts.${key}`, values);

/** Where the Pause texts page is: the banner's link goes there, and so does the Hub's menu. */
export const TEXTS_PAGE = "/staff/texts";

/** A moment as the Hub's staff read it: the day and the time in Toronto. */
export const formatWhen = (date: Date): string => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(date);

/** "Paused by Ann Okafor on Oct 5, 2026, 2:15 p.m.": the name is the account's, or "an Admin" when the account cannot be read. */
export const pausedBy = (status: PausedStatus, name: string | null): string => t("paused.by", { name: name ?? t("paused.someone"), when: formatWhen(status.pausedAt) });

/** "Why: ..." with the reason as the Admin gave it (cleaned to one line when it was saved). */
export const pausedWhy = (status: PausedStatus): string => t("paused.why", { reason: status.reason });

/**
 * "{n} texts were already handed to the provider and cannot be recalled": the sentence the pause screen and the sending progress view
 * (S06.09) both use, from the count the pause stored when it committed. Nothing when none had been handed over, or when the pause was set
 * before the count existed (null): a line that says "0 texts" would only worry people.
 */
export function handedOffLine(count: number | null): string | null {
  if (count === null || count <= 0) return null;
  return count === 1 ? t("paused.handedOffOne") : t("paused.handedOff", { n: count });
}

/** What the Hub says about a pause that is on, from the switch and the name of who set it. */
export interface PausedView {
  heading: string;
  by: string;
  why: string;
  /** Texts already handed to the provider when the pause committed; null when none were. */
  handedOff: string | null;
  /** The texts to on-call Admins that still go out. */
  oncall: string;
}

export function pausedView(status: PausedStatus, name: string | null): PausedView {
  return { heading: t("paused.banner"), by: pausedBy(status, name), why: pausedWhy(status), handedOff: handedOffLine(status.handedOffAtPause), oncall: t("oncall") };
}

/** "N texts are waiting" after a pause, in the number's own grammar (one, none, many). */
export function waitingLine(count: number): string {
  if (count <= 0) return t("done.waitingNone");
  return count === 1 ? t("done.waitingOne") : t("done.waiting", { n: count });
}

/** What a resume says it let go. */
export function resumedLine(count: number): string {
  if (count <= 0) return t("done.resumedNone");
  return count === 1 ? t("done.resumedOne") : t("done.resumed", { n: count });
}

/** The notice an approver sees while texts are paused (S04.07's approval screen shows it): the text still queues, and goes when resumed. */
export const approverPauseNotice = (): string => t("paused.approver");
