// The addresses of the alert composers and of "Log a disruption" (S04.05): one place, so a page that links to another does not import its
// code (the audience pages link back to the composer they were opened from).
export const LOG_PAGE = "/staff/alerts/log";
export const ACK_PAGE = "/staff/alerts/ack";
export const COMPOSE_PAGE = "/staff/alerts/compose";

/** Which composer a person came from: the acknowledgement (O-12) or the alert (O-02). */
export type ComposerFrom = "ack" | "compose";

export const isComposerFrom = (value: unknown): value is ComposerFrom => value === "ack" || value === "compose";

/** The composer of a draft, from where the person came. */
export const composerHref = (from: ComposerFrom, ref: { alertId: string; entryId: string }): string =>
  `${from === "ack" ? ACK_PAGE : COMPOSE_PAGE}?${new URLSearchParams({ alert: ref.alertId, entry: ref.entryId }).toString()}`;
