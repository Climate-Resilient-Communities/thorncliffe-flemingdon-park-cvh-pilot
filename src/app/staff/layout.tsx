import type { Metadata } from "next";
import { preload } from "react-dom";
import "../globals.css";
import "./fonts.generated.css";
import "./staff.css";
import { can } from "@/modules/identity";
import { activeHealthConditions, readHeartbeat } from "@/modules/ops";
import { getDb } from "@/platform/db";
import { AdminShortfallBanner } from "./AdminShortfallBanner";
import { logShortfallCheckFailure, showAdminShortfallBanner } from "./adminShortfall";
import { PUBLIC_SANS_LATIN } from "./fonts";
import { HealthBanner } from "./HealthBanner";
import { loadHealthBanner, logHealthBannerFailure, seesEveryCondition } from "./healthBannerModel";
import { hubShellUser, hubTabTitle } from "./hubShell";
import { identity } from "./identity";
import { messagingPause, pausedByName } from "./messagingPause";
import { PauseBanner } from "./PauseBanner";
import { loadPauseBanner, logPauseBannerFailure } from "./pauseBannerModel";
import { currentStaffSession } from "./session";
import { StaffShell } from "./StaffShell";

// Staff screens are per-user, so none is prerendered: no copy of a staff page
// ever sits in a CDN cache. The no-store header itself is set in next.config.ts (AD-1).
export const dynamic = "force-dynamic";

// The name of the tab on a page that sets none of its own: the pilot's "Hub", then the Hub's full name.
export const metadata: Metadata = { title: hubTabTitle() };

// A root layout of its own: the staff <html> is English, and a resident page's carries its language.
// Every Admin sees the "Fewer than two usable Admins" banner above each staff screen (S01.06), inside the
// Hub shell's content area when the shell is shown (S01.09). Everyone at the Hub sees "Texts are paused", with who
// paused, when and why, above each Hub screen while an Admin has paused texts (S06.06). Every Admin and Coordinator sees each condition the
// health job has found open, in plain words, above each Hub screen until it clears (S09.01); everyone else at the Hub sees "Sending is failing"
// while the sender itself is (S06.07). Links in the shell are plain
// anchors, so a move between staff screens is a full page load and this layout, with the banners, is evaluated again.
export default async function StaffLayout({ children }: LayoutProps<"/staff">) {
  // The one font file every staff page needs (Latin text), preloaded as the resident layout preloads its own.
  preload(PUBLIC_SANS_LATIN, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  const session = await currentStaffSession();
  const [shortfall, paused, failing] = await Promise.all([
    showAdminShortfallBanner({ session: async () => session, identity, logError: logShortfallCheckFailure }),
    // Only a Hub screen carries it: the sign-in page and the setup gates are not where to read about the Hub's texts.
    session && hubShellUser(session)
      ? loadPauseBanner({
          status: () => messagingPause().status(),
          nameOf: pausedByName,
          canResume: can(session.role, "sending.pause"),
          logError: logPauseBannerFailure,
        })
      : null,
    // The health banner (S06.07, S09.01): from what the health job last found, on a Hub screen only, like the pause banner.
    session && hubShellUser(session)
      ? loadHealthBanner({
          facts: async () => {
            const db = getDb();
            const [active, heartbeat] = await Promise.all([activeHealthConditions(db), readHeartbeat(db)]);
            return { active, heartbeat };
          },
          everything: seesEveryCondition(session.role),
          logError: logHealthBannerFailure,
        })
      : null,
  ]);
  return (
    <html lang="en">
      <body>
        <StaffShell session={session}>
          {failing && <HealthBanner view={failing} />}
          {paused && <PauseBanner view={paused} />}
          {shortfall && <AdminShortfallBanner />}
          {children}
        </StaffShell>
      </body>
    </html>
  );
}
