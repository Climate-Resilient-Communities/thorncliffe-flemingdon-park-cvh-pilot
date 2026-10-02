import type { ReactNode } from "react";
import { englishText } from "@/i18n/text";
import { StaffHubShell } from "@/ui/hub";
import { HUB_BRAND, hubNavigation, hubShellLabels, hubShellUser } from "./hubShell";
import type { StaffSession } from "./session";
import { SignOutButton } from "./SignOutButton";

/**
 * Frames the Hub's screens in the Hub shell (S01.09) for a person at the Hub gate; every other staff page (sign-in, the
 * setup gates, the 404) is shown as it is. The shell owns the <main>, so a page inside it renders a Screen, not a <main>.
 */
export function StaffShell({ session, children }: { session: StaffSession | null; children: ReactNode }) {
  const user = hubShellUser(session);
  if (!user) return <>{children}</>;
  return (
    <StaffHubShell
      user={user}
      navigation={hubNavigation(user.role)}
      labels={hubShellLabels()}
      signOut={<SignOutButton label={englishText("staff.signOut")} />}
      brand={HUB_BRAND}
    >
      {children}
    </StaffHubShell>
  );
}
