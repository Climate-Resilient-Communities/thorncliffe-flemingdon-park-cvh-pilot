import type { StaffRole } from "../../../contracts/staffRoles";
import { err, ok, type Result } from "./result";

/**
 * Bootstrap state (epic E01 definitions): initial setup only, from the creation of the first Admin
 * until two usable Admins exist for the first time. Stored as the one staff_bootstrap row; null
 * before the first Admin is created.
 */
export interface BootstrapState {
  firstAdminId: string;
  /** The one second Admin the first Admin created, once created. */
  secondAdminId: string | null;
  /** Set once, when bootstrap ended; it never returns, whatever happens to the Admins later. */
  completedAt: Date | null;
}

export type BootstrapPhase = "not_started" | "in_progress" | "completed";

export function bootstrapPhase(state: BootstrapState | null): BootstrapPhase {
  if (state === null) return "not_started";
  return state.completedAt === null ? "in_progress" : "completed";
}

/**
 * What a staff member is trying to do, as far as bootstrap is concerned.
 *  - complete_own_setup: replace their own starting password, enrol their own authenticator,
 *    read their own details, sign out (the setup sequence's gates, S01.07 and S01.10);
 *  - create_account: "Add a person" with this role;
 *  - other: anything else.
 */
export type StaffIntent =
  | { kind: "complete_own_setup" }
  | { kind: "create_account"; role: StaffRole }
  | { kind: "other" };

/** `creates_second_admin`: allowed, and the new account becomes bootstrap's second Admin. */
export type BootstrapDecision = "allowed" | "creates_second_admin";

/** Refused with "Finish setting up two Admins first". */
export type BootstrapRefusal = "bootstrap_incomplete";

/**
 * During bootstrap the first Admin may only complete their own setup or create one second Admin,
 * and the second Admin may only complete their own setup. Each may complete their own setup
 * without waiting for the other. Outside bootstrap (completed) nothing is restricted here; before
 * it (no first Admin yet) no account exists, and anything but own setup is refused (fail closed).
 */
export function decideUnderBootstrap(
  state: BootstrapState | null,
  actorId: string,
  intent: StaffIntent,
): Result<BootstrapDecision, BootstrapRefusal> {
  const phase = bootstrapPhase(state);
  if (phase === "completed") return ok("allowed");
  if (intent.kind === "complete_own_setup") return ok("allowed");
  if (
    state !== null &&
    intent.kind === "create_account" &&
    intent.role === "admin" &&
    actorId === state.firstAdminId &&
    state.secondAdminId === null
  ) {
    return ok("creates_second_admin");
  }
  return err("bootstrap_incomplete");
}

/**
 * Bootstrap ends when two usable Admins exist for the first time: the first and the second Admin
 * both usable (see isUsableAdmin). They may finish setup in either order, so this is checked after
 * each one's setup step; whichever finishes last ends it ("the second Admin becomes usable").
 * Once completed it stays completed.
 */
export function bootstrapCompletes(
  state: BootstrapState | null,
  usable: { firstAdmin: boolean; secondAdmin: boolean },
): boolean {
  return bootstrapPhase(state) === "in_progress" && state?.secondAdminId != null && usable.firstAdmin && usable.secondAdmin;
}
