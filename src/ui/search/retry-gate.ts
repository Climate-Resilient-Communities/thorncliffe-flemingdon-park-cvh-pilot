/**
 * "Told to wait" (a 429 with Retry-After): the phone does not ask again until it may, and the server is not called before
 * that. The time is held in this object only, never stored.
 */
export type RetryGate = {
  /** The server said to wait `seconds`. */
  waitFor: (seconds: number) => void;
  /** True while the wait has not passed. */
  closed: () => boolean;
};

export function createRetryGate(now: () => number = Date.now): RetryGate {
  let notBefore = 0;
  return {
    waitFor: (seconds) => {
      notBefore = now() + seconds * 1000;
    },
    closed: () => notBefore > now(),
  };
}
