"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ResidentText } from "../text/resident-text";

export type NavItem = {
  /** The prototype's destination: now (R-03), help (R-09), map (R-14), ready (R-24). */
  id: "now" | "help" | "map" | "ready";
  icon: "now" | "search" | "map" | "ready";
  label: string;
  href: string;
  /**
   * Other paths whose pages and the pages below them also belong to this item, so it stays marked as the current one there
   * (Find help is marked on the directory, whichever page it links to).
   */
  alsoCurrentOn?: readonly string[];
};

export type ResidentNavProps = {
  label: string;
  items: readonly NavItem[];
};

/** The item whose page this is: the exact path of its link or of one of its other paths, or a page below one (never home for every page). */
export function isCurrent(pathname: string, item: Pick<NavItem, "href" | "alsoCurrentOn">, isHome: boolean) {
  const path = pathname.replace(/\/$/, "");
  return [item.href, ...(item.alsoCurrentOn ?? [])].some((href) => path === href || (!isHome && path.startsWith(`${href}/`)));
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
          aria-current={isCurrent(pathname, item, item.id === "now") ? "page" : undefined}
          data-testid={`shell-nav-${item.id}`}
        >
          <span className={`shell-ico shell-ico--${item.icon}`} aria-hidden="true" />
          <span className="shell-nav__label">
            <ResidentText>{item.label}</ResidentText>
          </span>
        </Link>
      ))}
    </nav>
  );
}
