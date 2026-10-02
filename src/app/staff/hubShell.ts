// What the Hub shell (src/ui/hub) shows for a request: the person, the navigation and the words, from the
// session and the English catalog. The shell itself knows none of this; it takes the view model below.
import type { StaffRole } from "@/contracts/staffRoles";
import { englishText } from "@/i18n/text";
import { can } from "@/modules/identity";
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
 * The Hub's destinations for a role (HubApp's C_HubSide, the pilot's share of it). "In a disruption" lists the three
 * screens the pilot builds: incidents, composing an alert and check-in rounds. A screen whose story has not been
 * built has no page yet, so its item has no link (href null) and the story that builds the page sets it. Moderation,
 * the partner space ("This disruption") and the readiness area ("Between disruptions") are MVP scope, not in the
 * pilot. "Administration" is for Admins, as the pages in it are.
 * Which roles may open what is enforced by the server (S01.12). The menu is not filtered by role here yet: each
 * story that gives an item its href also filters that item by the roles that may open its page.
 */
export function hubNavigation(role: StaffRole): HubNavSection[] {
  const sections: HubNavSection[] = [
    {
      id: "disruption",
      label: englishText("hub.sections.disruption"),
      items: [
        { id: "incidents", label: englishText("hub.nav.incidents"), href: "/staff", exact: true, icon: "now" },
        { id: "compose", label: englishText("hub.nav.compose"), href: null, icon: "pencil" },
        { id: "rounds", label: englishText("hub.nav.rounds"), href: null, icon: "person" },
      ],
    },
  ];
  // Coverage (S01.14) is `coverage.view`: an Admin and a Coordinator, and a Director read-only. It sits with the
  // disruption screens because it says where a check-in round can be promised.
  if (can(role, "coverage.view")) sections[0].items = [...sections[0].items, { id: "coverage", label: englishText("hub.nav.coverage"), href: "/staff/coverage", icon: "ready" }];
  // Each Administration page is shown to the roles whose policy action opens it (S01.12): the people page is
  // `accounts.manage` and the providers page `provider.manage` (S02.04), both Admin only; the buildings page is
  // `buildings.manage` (S01.13), also Admin only.
  const admin: HubNavSection["items"][number][] = [];
  if (can(role, "accounts.manage")) admin.push({ id: "people", label: englishText("hub.nav.people"), href: "/staff/people", icon: "person" });
  if (can(role, "provider.manage")) admin.push({ id: "providers", label: englishText("hub.nav.providers"), href: "/staff/providers", icon: "inbox" });
  if (can(role, "buildings.manage")) admin.push({ id: "buildings", label: englishText("hub.nav.buildings"), href: "/staff/buildings", icon: "building" });
  if (admin.length > 0) sections.push({ id: "admin", label: englishText("hub.sections.admin"), items: admin });
  return sections;
}

/** The name of the tab on a staff page that sets none of its own: the pilot's "Hub", then the Hub's full name. */
export function hubTabTitle(): string {
  return `${englishText("staff.hub.title")} · ${englishText("shell.hubName")}`;
}

export function hubShellLabels(): HubShellLabels {
  return {
    // The pilot's name for the Hub (its home page's heading): "Hub and partner space" is the MVP's.
    appName: englishText("staff.hub.title"),
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
