// What the Hub shell (src/ui/hub) shows for a request: the person, the navigation and the words, from the
// session and the English catalog. The shell itself knows none of this; it takes the view model below.
import type { StaffRole } from "@/contracts/staffRoles";
import { englishText } from "@/i18n/text";
import { can } from "@/modules/identity";
import type { HubNavSection, HubShellLabels, HubShellUser } from "@/ui/hub";
import { COMPOSE_PAGE, LOG_PAGE } from "./alerts/pages";
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
 * The Hub's destinations for a role (HubApp's C_HubSide, the pilot's share of it). "In a disruption" lists the screens
 * the pilot builds: incidents, logging a disruption and composing an alert (S04.05) and check-in rounds. A screen whose
 * story has not been built has no page yet, so its item has no link (href null) and the story that builds the page sets
 * it. Moderation, the partner space ("This disruption") and the readiness area ("Between disruptions") are MVP scope,
 * not in the pilot. "Administration" is for Admins, as the pages in it are.
 * Which roles may open what is enforced by the server (S01.12). Each story that gives an item its href also filters
 * that item by the roles that may open its page: "Log a disruption" and "Compose an alert" are `alert.author_wide`, a
 * Coordinator and an Admin (S04.05).
 */
export function hubNavigation(role: StaffRole): HubNavSection[] {
  const sections: HubNavSection[] = [
    {
      id: "disruption",
      label: englishText("hub.sections.disruption"),
      items: [
        // An Ambassador's home is their own (A-01, S08.01), at the same address: the other roles' home is the Hub's incidents list.
        role === "ambassador"
          ? { id: "ambassador-home", label: englishText("hub.nav.ambassadorHome"), href: "/staff", exact: true, icon: "building" as const }
          : { id: "incidents", label: englishText("hub.nav.incidents"), href: "/staff", exact: true, icon: "now" as const },
        ...(can(role, "alert.author_wide")
          ? [
              { id: "log", label: englishText("hub.nav.log"), href: LOG_PAGE, icon: "flag" as const },
              { id: "compose", label: englishText("hub.nav.compose"), href: COMPOSE_PAGE, icon: "pencil" as const },
            ]
          : []),
        { id: "rounds", label: englishText("hub.nav.rounds"), href: null, icon: "person" },
      ],
    },
  ];
  // Coverage (S01.14) is `coverage.view`: an Admin and a Coordinator, and a Director read-only. It sits with the
  // disruption screens because it says where a check-in round can be promised.
  if (can(role, "coverage.view")) sections[0].items = [...sections[0].items, { id: "coverage", label: englishText("hub.nav.coverage"), href: "/staff/coverage", icon: "ready" }];
  // Each Administration page is shown to the roles whose policy action opens it (S01.12): the people page is
  // `accounts.manage`, the providers page `provider.manage` (S02.04), the directory release page `guide.publish` (S02.05),
  // the buildings page `buildings.manage` (S01.13) and the pause page `sending.pause` (S06.06), all Admin only.
  const admin: HubNavSection["items"][number][] = [];
  if (can(role, "accounts.manage")) admin.push({ id: "people", label: englishText("hub.nav.people"), href: "/staff/people", icon: "person" });
  if (can(role, "provider.manage")) admin.push({ id: "providers", label: englishText("hub.nav.providers"), href: "/staff/providers", icon: "inbox" });
  if (can(role, "guide.publish")) admin.push({ id: "directory", label: englishText("hub.nav.directory"), href: "/staff/directory", icon: "layers" });
  if (can(role, "buildings.manage")) admin.push({ id: "buildings", label: englishText("hub.nav.buildings"), href: "/staff/buildings", icon: "building" });
  if (can(role, "sending.pause")) admin.push({ id: "texts", label: englishText("hub.nav.texts"), href: "/staff/texts", icon: "pause" });
  // The on-call numbers page (S06.07) is `oncall.manage`, Admin only.
  if (can(role, "oncall.manage")) admin.push({ id: "oncall", label: englishText("hub.nav.oncall"), href: "/staff/oncall", icon: "phone" });
  // The Drills page (S06.05, start a drill, the drill roster, what became of each drill's texts) is `drill.run`, Admin only.
  if (can(role, "drill.run")) admin.push({ id: "drills", label: englishText("hub.nav.drills"), href: "/staff/drills", icon: "phone" });
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
