// "This alert may have ended" (S05.07, NFR-N3): an alert read from a copy the phone kept, with no signal, is never shown as current once its valid-until has passed. The phone
// cannot ask the server what time it is, so it uses the last time it knew: the server's clock (`server_now`) when the copy was made, against the phone's own clock when it
// got it. The difference is the offset between the two clocks, and the phone's clock plus that offset is the server's time as best it is known, so a phone whose clock is
// hours wrong still says "may have ended" at the right time, and an alert is never called ended because of a wrong clock. Pure and with no clock of its own: unit-tested
// (may-have-ended.test.ts).

/** The server's clock minus the phone's, in ms, as of when the copy was received: `serverNow` is when the server built it, `receivedAt` the phone's clock then (ms since 1970). */
export function clockOffsetMs(serverNow: Date | string, receivedAt: number): number {
  return new Date(serverNow).getTime() - receivedAt;
}

/** The server's time as the phone best knows it at phone time `now` (ms since 1970), given the offset of the last copy. */
export const serverTimeAt = (now: number, offsetMs: number): number => now + offsetMs;

/**
 * Whether an alert whose valid-until is `validUntil` has passed at phone time `now`, adjusted by `offsetMs`. At the valid-until itself it is over (the same rule as the
 * server's `validUntilLine`: a valid-until that is not in the future has passed).
 */
export function mayHaveEnded(validUntil: Date | string, input: { now: number; offsetMs: number }): boolean {
  return new Date(validUntil).getTime() <= serverTimeAt(input.now, input.offsetMs);
}

/** Whether the page on screen is not the server's own answer: a kept copy still describing it, or the phone has lost signal. */
export const isOfflineView = (input: { online: boolean; servedKeptAt: number | null }): boolean => !input.online || input.servedKeptAt !== null;

/** The phone's clock when the page on screen was received: the kept copy's own time, else when this view mounted (never when the document loaded, which may be hours before). */
export const receivedAtFor = (input: { servedKeptAt: number | null; mountedAt: number }): number => input.servedKeptAt ?? input.mountedAt;
