// What the Hub shell (src/ui/hub) shows for a request: the person, the navigation and the words, from the
// session and the English catalog. The shell itself knows none of this; it takes the view model below.
import type { StaffRole } from "@/contracts/staffRoles";
import { englishText } from "@/i18n/text";
import type { HubNavSection, HubShellLabels, HubShellUser } from "@/ui/hub";
import type { StaffSession } from "./session";

/**
 * The shell's person for a session, or null for no shell. The shell frames only the Hub itself, which a person
 * reaches at the last gate of the setup sequence: the sign-in page (no session) and the pages that hold someone at
 * an earlier gate (choose a password, enrol an authenticator) are not shown inside it.
 */
export function hubShellUser(session: StaffSession | null): HubShellUser | null {
  if (!session || session.gate !== "hub") return null;
  return { displayName: `${session.firstName} ${session.lastName}`, role: session.role };
}

/**
 * The Hub's destinations for a role (HubApp's C_HubSide, the pilot's share of it). "In a disruption" lists the four
 * screens the pilot builds; a screen whose story has not been built has no page yet, so its item has no link
 * (href null) and the story that builds the page sets it. The partner space ("This disruption") and the readiness
 * area ("Between disruptions") are not in the pilot. "Administration" is for Admins, as the pages in it are.
 * Which roles may open what is enforced by the server (S01.12); this only keeps the menu to what a person can use.
 */
export function hubNavigation(role: StaffRole): HubNavSection[] {
  const sections: HubNavSection[] = [
    {
      id: "disruption",
      label: englishText("hub.sections.disruption"),
      items: [
        { id: "incidents", label: englishText("hub.nav.incidents"), href: "/staff", exact: true, icon: "now" },
        { id: "compose", label: englishText("hub.nav.compose"), href: null, icon: "pencil" },
        { id: "moderation", label: englishText("hub.nav.moderation"), href: null, icon: "inbox" },
        { id: "rounds", label: englishText("hub.nav.rounds"), href: null, icon: "person" },
      ],
    },
  ];
  if (role === "admin") {
    sections.push({
      id: "admin",
      label: englishText("hub.sections.admin"),
      items: [{ id: "people", label: englishText("hub.nav.people"), href: "/staff/people", icon: "person" }],
    });
  }
  return sections;
}

export function hubShellLabels(): HubShellLabels {
  return {
    appName: englishText("hub.appName"),
    menu: englishText("hub.menu"),
    closeMenu: englishText("hub.closeMenu"),
    // Left as a template: the shell fills {name} and {role}, isolating the name.
    signedInAs: englishText("staff.signedInAs", { name: "{name}", role: "{role}" }),
    roles: {
      ambassador: englishText("staff.roles.ambassador"),
      coordinator: englishText("staff.roles.coordinator"),
      director: englishText("staff.roles.director"),
      admin: englishText("staff.roles.admin"),
    },
    logoAlt: englishText("shell.hubLogoAlt"),
  };
}

export const HUB_BRAND = { logoSrc: "/brand/hub-logo.png", symbolSrc: "/brand/hub-symbol.png" } as const;
