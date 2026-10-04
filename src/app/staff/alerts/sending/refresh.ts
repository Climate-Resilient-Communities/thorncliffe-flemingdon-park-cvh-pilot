// The sending progress reloads itself while texts are going out (S06.09): every `seconds` it asks the page to render again from the server, unless the
// page is hidden (a background tab does not hammer the database). Plain functions so the timing is tested without a browser; AutoRefresh.tsx wires them to
// the router.

export interface RefreshTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: RefreshTimers = { set: (callback, ms) => setInterval(callback, ms), clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) };

/**
 * Calls `refresh` every `seconds` while `visible()` is true. Returns the function that stops it. A whole number of seconds from 1 up; anything else
 * is a programming mistake and throws, so a page can never end up refreshing in a tight loop.
 */
export function startRefresh(refresh: () => void, seconds: number, visible: () => boolean = () => typeof document === "undefined" || document.visibilityState === "visible", timers: RefreshTimers = realTimers): () => void {
  if (!Number.isInteger(seconds) || seconds < 1) throw new RangeError("The refresh interval is a whole number of seconds, 1 or more");
  const handle = timers.set(() => {
    if (visible()) refresh();
  }, seconds * 1000);
  return () => timers.clear(handle);
}
