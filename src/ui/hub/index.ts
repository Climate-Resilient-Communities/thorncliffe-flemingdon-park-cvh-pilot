// The Hub shell's import surface: app code imports from "@/ui/hub". It is separate from "@/ui" because the connected
// shell pulls in Next's navigation, which the layout primitives (and the layout tests that bundle them without
// Next) do not need; those tests import "./hub-shell" itself.
export { StaffHubShell } from "./hub-shell-connected";
export type { HubShellLabels, HubShellProps, HubShellUser } from "./hub-shell";
export { HUB_NAV_ICONS, isCurrentPage, type HubNavIcon, type HubNavItem, type HubNavSection } from "./hub-nav";
