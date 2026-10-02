import type { IdentityService } from "@/modules/identity";
import type { StaffSession } from "./session";

export interface AdminShortfallDeps {
  session: () => Promise<StaffSession | null>;
  identity: () => Pick<IdentityService, "adminShortfallBanner">;
  /** Operational error log (structured, no personal data). */
  logError: (fields: Record<string, string>) => void;
}

/**
 * Whether the staff layout shows the "Fewer than two usable Admins" banner to this request's staff
 * member (S01.06). Without a session there is nothing to show. If the check fails, the screen is
 * still shown, without the banner, and the failure is logged: the banner informs, it guards nothing.
 */
export async function showAdminShortfallBanner(deps: AdminShortfallDeps): Promise<boolean> {
  const session = await deps.session();
  if (!session) return false;
  try {
    return await deps.identity().adminShortfallBanner(session.staffId);
  } catch (error) {
    deps.logError({ error: error instanceof Error ? error.constructor.name : "unknown" });
    return false;
  }
}

export function logShortfallCheckFailure(fields: Record<string, string>): void {
  console.log(JSON.stringify({ level: "error", evt: "identity.admin_shortfall_check_failed", module: "app", ...fields }));
}
