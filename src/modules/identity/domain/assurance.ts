import type { AssuranceLevel } from "../../../contracts/staffAuth";
import type { PolicyAction } from "./policy";

/**
 * The privileged actions (AD-4, spine "identity"): approve, send, correct, withdraw, drill,
 * publish, cap, pause and account changes. Each runs only from an `aal2` session (S01.10): an
 * Admin or Coordinator who entered an authenticator code at this sign-in. The pilot asks for the
 * code once per sign-in, never per action.
 *
 * The names are policy actions (./policy.ts, S01.12): a route or action names its policy action,
 * the guard asks `can(role, action, context)` first and then, for these, requires `aal2`. Only
 * `accounts.manage` has server actions today (Add a person, Re-issue, Reset password); each story
 * that adds one of the others names it on its route or action.
 */
export const PRIVILEGED_ACTIONS = [
  "accounts.manage",
  "alert.approve",
  "alert.send",
  "alert.correct",
  "alert.withdraw",
  "drill.run",
  "guide.publish",
  "spend.cap",
  "sending.pause",
] as const satisfies readonly PolicyAction[];

export type PrivilegedAction = (typeof PRIVILEGED_ACTIONS)[number];

/** True for a name in PRIVILEGED_ACTIONS. */
export function isPrivilegedAction(name: string): name is PrivilegedAction {
  return (PRIVILEGED_ACTIONS as readonly string[]).includes(name);
}

/** The level every privileged action needs. A table so S01.12 (or a later MVP step-up) can raise one. */
export const REQUIRED_ASSURANCE: Record<PrivilegedAction, AssuranceLevel> = Object.fromEntries(
  PRIVILEGED_ACTIONS.map((action) => [action, "aal2"]),
) as Record<PrivilegedAction, AssuranceLevel>;

const RANK: Record<AssuranceLevel, number> = { aal1: 1, aal2: 2 };

/**
 * requireAal2's rule, without I/O: whether a session at `aal` may run `action`. Any role: a
 * Director or Ambassador (always `aal1`) is refused here too, whatever S01.12's role rules say.
 */
export function meetsAssurance(aal: AssuranceLevel, action: PrivilegedAction): boolean {
  return RANK[aal] >= RANK[REQUIRED_ASSURANCE[action]];
}
