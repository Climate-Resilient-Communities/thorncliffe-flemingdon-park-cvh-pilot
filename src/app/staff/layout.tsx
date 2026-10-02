import "../globals.css";
import { AdminShortfallBanner } from "./AdminShortfallBanner";
import { logShortfallCheckFailure, showAdminShortfallBanner } from "./adminShortfall";
import { identity } from "./identity";
import { currentStaffSession } from "./session";

// Staff screens are per-user, so none is prerendered: no copy of a staff page
// ever sits in a CDN cache. The no-store header itself is set in next.config.ts (AD-1).
export const dynamic = "force-dynamic";

// A root layout of its own: the staff <html> is English, and a resident page's carries its language.
// Every Admin sees the "Fewer than two usable Admins" banner above each staff screen (S01.06).
// A layout is re-evaluated only on full page loads, not on client navigation between staff screens
// (S01.09 to revisit how the banner stays current).
export default async function StaffLayout({ children }: LayoutProps<"/staff">) {
  const shortfall = await showAdminShortfallBanner({ session: currentStaffSession, identity, logError: logShortfallCheckFailure });
  return (
    <html lang="en">
      <body>
        {shortfall && <AdminShortfallBanner />}
        {children}
      </body>
    </html>
  );
}
