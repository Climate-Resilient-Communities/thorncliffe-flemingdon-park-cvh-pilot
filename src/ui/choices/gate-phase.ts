import type { ChoicesSnapshot } from "./choices-store";

/** Where the first-run gate stands: not yet read, sending the resident to R-01, or showing home. */
export type GatePhase = "pending" | "redirecting" | "ready";

/**
 * A first visit (no valid `cvh.choices`, or the first-run steps not yet gone through) is sent to R-01, unless the phone
 * keeps nothing: then it would send the resident through the steps on every visit, and home is shown, with its link to
 * "What I have told the CVH", instead.
 *
 * @param choices the saved choices, undefined until the phone has been read
 * @param storageUsable whether the phone keeps what is written to it, undefined until it has been probed
 */
export function gatePhase(choices: ChoicesSnapshot | undefined, storageUsable: boolean | undefined): GatePhase {
  if (choices === undefined || storageUsable === undefined) return "pending";
  if (!storageUsable) return "ready";
  return choices?.welcomed === true ? "ready" : "redirecting";
}
