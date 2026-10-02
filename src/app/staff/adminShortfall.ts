import type { IdentityService } from "@/modules/identity";
import type { StaffSession } from "./session";

export interface AdminShortfallDeps {
  session: () => Promise<StaffSession | null>;
  identity: () => Pick<IdentityService, "adminShortfallBanner">;
  /** Operational error log (structured, no personal data). */
  logError: (fields: Record<string, string>) => void;
  /** How long the check may take before the screen is shown without the banner (default 2 s). */
  timeoutMs?: number;
}

/** The banner informs and guards nothing, so a slow check must never hold the staff screen back. */
export const BANNER_TIMEOUT_MS = 2000;

class BannerTimeout extends Error {
  constructor() {
    super("banner check timed out");
    this.name = "BannerTimeout";
  }
}

/**
 * Whether the staff layout shows the "Fewer than two usable Admins" banner to this request's staff
 * member (S01.06). Without a session there is nothing to show. If the check fails, the screen is
 * still shown, without the banner, and the failure is logged: the banner informs, it guards nothing.
 * The same when the check takes longer than two seconds (the identity provider is slow).
 */
export async function showAdminShortfallBanner(deps: AdminShortfallDeps): Promise<boolean> {
  const session = await deps.session();
  if (!session) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new BannerTimeout()), deps.timeoutMs ?? BANNER_TIMEOUT_MS);
    });
    return await Promise.race([deps.identity().adminShortfallBanner(session.staffId), deadline]);
  } catch (error) {
    deps.logError({ error: error instanceof Error ? error.constructor.name : "unknown" });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function logShortfallCheckFailure(fields: Record<string, string>): void {
  console.log(JSON.stringify({ level: "error", evt: "identity.admin_shortfall_check_failed", module: "app", ...fields }));
}
