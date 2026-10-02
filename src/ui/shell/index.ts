// The resident shell's import surface: app code imports from "@/ui/shell". It is separate from "@/ui" because the
// shell pulls in Next's navigation and image components, which the layout primitives (and the layout tests that
// bundle them without Next) do not need.
export { ResidentShell, type ResidentShellProps } from "./resident-shell";
export type { NavItem, ResidentNavProps } from "./resident-nav";
export type { LanguageOption } from "./language-control";
