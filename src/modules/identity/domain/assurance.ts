import type { AssuranceLevel } from "../../../contracts/staffAuth";
import { STAFF_ROLES, type StaffRole } from "../../../contracts/staffRoles";
import type { PolicyAction } from "./policy";
import { needsAuthenticator } from "./setupGate";

/**
 * The privileged actions (AD-4, spine "identity"): approve, send, correct, withdraw, drill,
 * publish, cap, pause and account changes, and the Admin's building and floor edits (S01.13).
 * For the roles that enrol an authenticator, Admin and Coordinator, each runs only from an `aal2`
 * session (S01.10): they entered an authenticator code at this sign-in. The pilot asks for the code
 * once per sign-in, never per action. An Ambassador has no authenticator and signs in at `aal1`:
 * the one privileged action their row of the matrix allows, correcting or withdrawing their own
 * pending entry, needs no more than that.
 *
 * The names are policy actions (./policy.ts, S01.12): a route or action names its policy action,
 * the guard asks `can(role, action, context)` first and then, for these, requires `aal2`. Only
 * `accounts.manage` has server actions today (Add a person, Re-issue, Reset password) and so has
 * `buildings.manage` (rename, add and remove floors, confirm a building); each story
 * that adds one of the others names it on its route or action. `provider.manage` (S02.04) is
 * publishing a provider and confirming it. `sms.test_send` (S01.15, the first-text spike) is the
 * one action that is not in the spine's list: a test text sent from production, Admin only; E06
 * removes it with the spike.
 */
export const PRIVILEGED_ACTIONS = [
  "accounts.manage",
  "alert.approve",
  "alert.send",
  "alert.correct",
  "alert.withdraw",
  "drill.run",
  "guide.publish",
  "provider.manage",
  "spend.cap",
  "sending.pause",
  "buildings.manage",
  "sms.test_send",
] as const satisfies readonly PolicyAction[];

export type PrivilegedAction = (typeof PRIVILEGED_ACTIONS)[number];

/** True for a name in PRIVILEGED_ACTIONS. */
export function isPrivilegedAction(name: string): name is PrivilegedAction {
  return (PRIVILEGED_ACTIONS as readonly string[]).includes(name);
}

/**
 * The level every privileged action needs, per role: `aal2` for the roles that enrol an
 * authenticator (AD-4: "TOTP (aal2) is required for every Admin and Coordinator session"), `aal1`
 * for the others, whose sessions cannot reach `aal2`. A table so a later MVP step-up can raise one.
 * Whether the role may do the action at all is the role policy's call (./policy.ts), asked first.
 */
export const REQUIRED_ASSURANCE: Record<PrivilegedAction, Record<StaffRole, AssuranceLevel>> = Object.fromEntries(
  PRIVILEGED_ACTIONS.map((action) => [action, Object.fromEntries(STAFF_ROLES.map((role) => [role, needsAuthenticator(role) ? "aal2" : "aal1"]))]),
) as Record<PrivilegedAction, Record<StaffRole, AssuranceLevel>>;

const RANK: Record<AssuranceLevel, number> = { aal1: 1, aal2: 2 };

/**
 * requireAal2's rule, without I/O: whether a `role` session at `aal` may run `action`. It is the
 * assurance rule only; a role the policy refuses (a Director) is refused by the policy first.
 */
export function meetsAssurance(role: StaffRole, aal: AssuranceLevel, action: PrivilegedAction): boolean {
  const required = REQUIRED_ASSURANCE[action]?.[role];
  return required !== undefined && RANK[aal] >= RANK[required];
}
