import { AdminShortfallBanner } from "./AdminShortfallBanner";
import { logShortfallCheckFailure, showAdminShortfallBanner } from "./adminShortfall";
import { identity } from "./identity";
import { currentStaffSession } from "./session";

// Staff screens are per-user, so none is prerendered: no copy of a staff page
// ever sits in a CDN cache. The no-store header itself is set in next.config.ts (AD-1).
export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: LayoutProps<"/staff">) {
  const shortfall = await showAdminShortfallBanner({ session: currentStaffSession, identity, logError: logShortfallCheckFailure });
  return (
    <>
      {shortfall && <AdminShortfallBanner />}
      {children}
    </>
  );
}
