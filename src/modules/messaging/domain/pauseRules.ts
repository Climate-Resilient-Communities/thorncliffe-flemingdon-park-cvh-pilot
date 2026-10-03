/**
 * The pause's rules (S06.06, AD-8, E06 "Pause"), pure: no I/O, no clock. One Admin switch stops every text the pause applies to that
 * has not been handed to the provider; which texts it applies to is `pauseApplies` (dispatchRules.ts): everything but the texts to
 * on-call numbers, so a problem is still reported while texts are paused.
 *
 * The reason an Admin gives is shown, as typed, on every Hub screen, so it is cleaned (one line, no stray spaces) and kept to the
 * length the table allows (`messaging_control_reason_length`: 1 to 500 characters once trimmed).
 */

/** The longest reason, in characters (code points, as the table counts them). */
export const PAUSE_REASON_MAX_CHARS = 500;

/** Why a reason is not accepted: `missing` (nothing but spaces) or `too_long`. */
export type PauseReasonProblem = "missing" | "too_long";

export type CleanedReason = { ok: true; reason: string } | { ok: false; problem: PauseReasonProblem };

/**
 * A reason as it is stored and shown: trimmed, with every run of white space (a pasted line break, a tab) as one space, so it reads as one
 * line in the banner. Anything that is not text, or is only spaces, is `missing`; one longer than PAUSE_REASON_MAX_CHARS is `too_long`.
 * Control characters other than white space are dropped (they print as nothing, or as boxes).
 */
export function cleanPauseReason(raw: unknown): CleanedReason {
  if (typeof raw !== "string") return { ok: false, problem: "missing" };
  const reason = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (reason === "") return { ok: false, problem: "missing" };
  if ([...reason].length > PAUSE_REASON_MAX_CHARS) return { ok: false, problem: "too_long" };
  return { ok: true, reason };
}
