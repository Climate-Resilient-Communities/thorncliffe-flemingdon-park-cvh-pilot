"use client";

import { usePathname } from "next/navigation";
import { HubShell, type HubShellProps } from "./hub-shell";

/**
 * The shell for the app: the same HubShell, with the current page read from the URL. A client component only
 * for that, because the layout that holds the shell does not know which page it frames; the markup is still
 * rendered on the server, so the current page is announced before any script runs.
 */
export function StaffHubShell(props: Omit<HubShellProps, "currentPath">) {
  return <HubShell {...props} currentPath={usePathname()} />;
}
