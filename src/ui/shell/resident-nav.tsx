"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = {
  /** The prototype's destination: now (R-03), help (R-09), map (R-14), ready (R-24). */
  id: "now" | "help" | "map" | "ready";
  icon: "now" | "search" | "map" | "ready";
  label: string;
  href: string;
};

export type ResidentNavProps = {
  label: string;
  items: readonly NavItem[];
};

/** The item whose page this is: the exact path, or a page below it (never home for every page). */
function isCurrent(pathname: string, href: string, isHome: boolean) {
  const path = pathname.replace(/\/$/, "");
  return path === href || (!isHome && path.startsWith(`${href}/`));
}

/**
 * C_ResidentNav: four equal destinations at the block end of the shell. A client component only to read
 * the path: the shell lives in the layout, which does not know which page it frames.
 */
export function ResidentNav({ label, items }: ResidentNavProps) {
  const pathname = usePathname();
  return (
    <nav className="shell-nav" aria-label={label} data-testid="shell-nav">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          prefetch={false}
          className="shell-nav__item tap"
          aria-current={isCurrent(pathname, item.href, item.id === "now") ? "page" : undefined}
          data-testid={`shell-nav-${item.id}`}
        >
          <span className={`shell-ico shell-ico--${item.icon}`} aria-hidden="true" />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
