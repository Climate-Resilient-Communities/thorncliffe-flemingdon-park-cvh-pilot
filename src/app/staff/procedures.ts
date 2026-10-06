// The written procedures (S09.03, NFR-N6): one page each in docs/procedures, and the link a Hub screen that starts one of them shows under its lead. The link
// points at the page on GitHub's main branch (the repository is public), opened in a new tab so a half-written alert is not lost: the pages are reviewed in
// pull requests like the code, carry their owner and last-reviewed date, and are never a second copy the Hub would have to keep in step. Nothing is fetched
// or rendered by the app (no route, no markdown renderer); the page is a plain link, so no stylesheet, script or connection is added.
import { englishText } from "@/i18n/text";

/** The procedures a Hub screen starts, by the name of their page in docs/procedures (without `.md`). */
export const SCREEN_PROCEDURES = [
  "write-and-approve-an-alert",
  "correct-or-withdraw",
  "close-an-alert",
  "run-a-drill",
  "pause-and-resume-texts",
  "resend-failed-texts",
  "cap-overrun",
  "health-alert",
  "rotate-secrets",
] as const;
export type ProcedureId = (typeof SCREEN_PROCEDURES)[number];

/** Where docs/procedures is read: the repository's main branch on GitHub. */
export const PROCEDURES_BASE_URL = "https://github.com/Climate-Resilient-Communities/thorncliffe-flemingdon-park-cvh-pilot/blob/main/docs/procedures";

/** The page of a procedure. */
export const procedureUrl = (id: ProcedureId): string => `${PROCEDURES_BASE_URL}/${id}.md`;

/** The words of a procedure's link: "Procedure: pausing and resuming texts (opens in a new tab)". */
export const procedureLinkText = (id: ProcedureId): string => englishText("staff.procedures.link", { title: englishText(`staff.procedures.titles.${id}`) });

/** A procedure's link as a screen draws it: built on the server (the catalog stays out of the browser), drawn by ProcedureLink. */
export interface ProcedureLinkView {
  id: ProcedureId;
  href: string;
  text: string;
}

export const procedureLink = (id: ProcedureId): ProcedureLinkView => ({ id, href: procedureUrl(id), text: procedureLinkText(id) });

/** The procedure a composer starts: a drill's is the drill's; a correction or withdrawal, a closing, or else writing an alert. */
export function composerProcedure(from: string, isDrill: boolean): ProcedureId {
  if (isDrill) return "run-a-drill";
  if (from === "correct" || from === "withdraw") return "correct-or-withdraw";
  if (from === "resolve") return "close-an-alert";
  return "write-and-approve-an-alert";
}

/** The procedure an approval belongs to, by the entry's kind: a drill's; a correction's or a withdrawal's; a final's (it closes the alert); or an alert's. */
export function approvalProcedure(kind: string, isDrill: boolean): ProcedureId {
  if (isDrill) return "run-a-drill";
  if (kind === "correction" || kind === "withdrawal") return "correct-or-withdraw";
  if (kind === "final") return "close-an-alert";
  return "write-and-approve-an-alert";
}
