// The addresses of the alert composers and of "Log a disruption" (S04.05): one place, so a page that links to another does not import its
// code (the audience pages link back to the composer they were opened from).
export const LOG_PAGE = "/staff/alerts/log";
export const ACK_PAGE = "/staff/alerts/ack";
export const COMPOSE_PAGE = "/staff/alerts/compose";
/** "Add an update" (O-14, S05.01): an update to an alert that is already running. */
export const UPDATE_PAGE = "/staff/alerts/update";
/** "Promote to full alert" (O-13, S05.01): the first update to an acknowledgement. */
export const PROMOTE_PAGE = "/staff/alerts/promote";

/** "Correct" (O-15, S05.02): a correction of an entry residents read, added to the same alert in the open. */
export const CORRECT_PAGE = "/staff/alerts/correct";
/** "Withdraw" (O-15, S05.02): a withdrawal of an entry residents read, with a reason from the catalog. */
export const WITHDRAW_PAGE = "/staff/alerts/withdraw";

/** "Mark resolved" (O-16, S05.03): the final message that closes a running alert once a second person approves it. */
export const RESOLVE_PAGE = "/staff/alerts/resolve";

/**
 * Which composer a person came from: the acknowledgement (O-12), the alert (O-02), an update to a running alert (O-14), the promotion of an
 * acknowledgement (O-13), a correction (O-15), a withdrawal (O-15) or the final message of "Mark resolved" (O-16).
 */
export type ComposerFrom = "ack" | "compose" | "update" | "promote" | "correct" | "withdraw" | "resolve";

const COMPOSER_PAGES: Record<ComposerFrom, string> = {
  ack: ACK_PAGE,
  compose: COMPOSE_PAGE,
  update: UPDATE_PAGE,
  promote: PROMOTE_PAGE,
  correct: CORRECT_PAGE,
  withdraw: WITHDRAW_PAGE,
  resolve: RESOLVE_PAGE,
};

export const isComposerFrom = (value: unknown): value is ComposerFrom => typeof value === "string" && Object.hasOwn(COMPOSER_PAGES, value);

/** The page of a composer. */
export const composerPage = (from: ComposerFrom): string => COMPOSER_PAGES[from];

/**
 * The composer an entry is written on: the acknowledgement's for an `ack`; the alert's for the thread's first entry when it is an update (a full alert
 * written without an acknowledgement); and, for an update that follows other entries, "Promote to full alert" while every earlier entry is an
 * acknowledgement (it is the first update) and "Add an update" after that (S05.01). `priorKinds` are the kinds of the entries made before it.
 */
export function composerOf(kind: string, priorKinds: readonly string[] = []): ComposerFrom {
  if (kind === "ack") return "ack";
  // A correction and a withdrawal (S05.02) are written on their own pages, whatever came before them.
  if (kind === "correction") return "correct";
  if (kind === "withdrawal") return "withdraw";
  // A final (S05.03) is written on its own page.
  if (kind === "final") return "resolve";
  if (priorKinds.length === 0) return "compose";
  return priorKinds.every((prior) => prior === "ack") ? "promote" : "update";
}

/** The composer of a draft, from where the person came. */
export const composerHref = (from: ComposerFrom, ref: { alertId: string; entryId: string }): string =>
  `${composerPage(from)}?${new URLSearchParams({ alert: ref.alertId, entry: ref.entryId }).toString()}`;

/** The start of an update to a running alert: nothing is made until the author saves it (S05.01). `promote` is the first update to an acknowledgement. */
export const updateHref = (alertId: string, promote: boolean): string => `${promote ? PROMOTE_PAGE : UPDATE_PAGE}?${new URLSearchParams({ alert: alertId }).toString()}`;

/** The start of a correction (O-15): the entries that can be corrected, and, with `target`, the form for that one. */
export const correctHref = (alertId: string, target?: string): string => `${CORRECT_PAGE}?${new URLSearchParams({ alert: alertId, ...(target ? { target } : {}) }).toString()}`;

/** The start of a withdrawal (O-15): the entries that can be withdrawn, and, with `target`, the form for that one. */
export const withdrawHref = (alertId: string, target?: string): string => `${WITHDRAW_PAGE}?${new URLSearchParams({ alert: alertId, ...(target ? { target } : {}) }).toString()}`;

/** The start of "Mark resolved" (O-16): the final message of a running alert; nothing is made until the author saves it. */
export const resolveHref = (alertId: string): string => `${RESOLVE_PAGE}?${new URLSearchParams({ alert: alertId }).toString()}`;

/** The approval view (O-05, O-07; S04.07): where a second person reads exactly what goes out and approves, returns or discards it. */
export const APPROVE_PAGE = "/staff/alerts/approve";

/** The approval view of an entry. */
export const approveHref = (ref: { alertId: string; entryId: string }): string => `${APPROVE_PAGE}?${new URLSearchParams({ alert: ref.alertId, entry: ref.entryId }).toString()}`;
