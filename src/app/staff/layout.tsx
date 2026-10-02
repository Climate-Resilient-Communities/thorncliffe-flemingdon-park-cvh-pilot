import type { Metadata } from "next";
import "../globals.css";
import { englishText } from "@/i18n/text";
import { AdminShortfallBanner } from "./AdminShortfallBanner";
import { logShortfallCheckFailure, showAdminShortfallBanner } from "./adminShortfall";
import { identity } from "./identity";
import { currentStaffSession } from "./session";
import { StaffShell } from "./StaffShell";

// Staff screens are per-user, so none is prerendered: no copy of a staff page
// ever sits in a CDN cache. The no-store header itself is set in next.config.ts (AD-1).
export const dynamic = "force-dynamic";

// The name of the tab on a page that sets none of its own.
export const metadata: Metadata = { title: englishText("hub.appName") };

// A root layout of its own: the staff <html> is English, and a resident page's carries its language.
// Every Admin sees the "Fewer than two usable Admins" banner above each staff screen (S01.06), inside the
// Hub shell's content area when the shell is shown (S01.09). Links in the shell are plain anchors, so a move
// between staff screens is a full page load and this layout, with the banner, is evaluated again.
export default async function StaffLayout({ children }: LayoutProps<"/staff">) {
  const shortfall = await showAdminShortfallBanner({ session: currentStaffSession, identity, logError: logShortfallCheckFailure });
  return (
    <html lang="en">
      <body>
        <StaffShell session={await currentStaffSession()}>
          {shortfall && <AdminShortfallBanner />}
          {children}
        </StaffShell>
      </body>
    </html>
  );
}
