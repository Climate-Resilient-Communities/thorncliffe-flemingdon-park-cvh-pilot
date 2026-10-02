import type { StaffRole } from "../../../contracts/staffRoles";
import { can, type PolicyAction, type PolicyContext } from "./policy";
import type { StaffStatus } from "./staffAccount";

/** The staff member acting, as the rules need them. */
export interface Actor {
  id: string;
  role: StaffRole;
  status: StaffStatus;
}

/**
 * Whether this staff member, as they are now, may do `action` (AD-4): an active account whose role
 * the policy (`can`, ./policy.ts) allows, with the actor's id in the context. The use cases ask it
 * with the account they just read, and again under their lock, so a role or status changed since
 * the request's guard ran is caught. It does not check the session's authenticator level or the
 * setup gates: the staff guard does, where the session is resolved.
 */
export function actorCan(actor: Actor, action: PolicyAction, context: PolicyContext = {}): boolean {
  return actor.status === "active" && can(actor.role, action, { ...context, actorId: actor.id });
}
