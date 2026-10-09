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

/**
 * Where the navigation is drawn. The same four destinations are rendered twice and CSS shows one: on a phone, `bar` at the
 * block end of the shell (after the main, as approved); from the desktop breakpoint, `header` in the header row, before the
 * main, so a keyboard and a screen reader reach it before the page. The other copy is `display: none`, out of the
 * accessibility tree, so there is only ever one navigation landmark.
 */
export type NavPlacement = "bar" | "header";

/**
 * The item whose page this is: the exact path of its link or of one of its other paths, or a page below one. Home's own path is the
 * exception: every page is below it, so home is current on that path alone (and on the other paths it was given, such as the alerts).
 */
export function isCurrent(pathname: string, item: Pick<NavItem, "href" | "alsoCurrentOn">, isHome: boolean) {
  const path = pathname.replace(/\/$/, "");
  const own = path === item.href || (!isHome && path.startsWith(`${item.href}/`));
  return own || (item.alsoCurrentOn ?? []).some((href) => path === href || path.startsWith(`${href}/`));
}

/**
 * C_ResidentNav: four equal destinations at the block end of the shell on a phone, or a row in the desktop header
 * (`placement`). A client component only to read the path: the shell lives in the layout, which does not know which page it frames.
 */
export function ResidentNav({ label, items, placement = "bar" }: ResidentNavProps & { placement?: NavPlacement }) {
  const pathname = usePathname();
  const base = placement === "bar" ? "shell-nav" : "shell-topnav";
  return (
    <nav className={base} aria-label={label} data-testid={base}>
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          prefetch={false}
          className={`${base}__item tap`}
          aria-current={isCurrent(pathname, item, item.id === "now") ? "page" : undefined}
          data-testid={`${base}-${item.id}`}
        >
          <span className={`shell-ico shell-ico--${item.icon}`} aria-hidden="true" />
          <span className={`${base}__label`}>
            <ResidentText>{item.label}</ResidentText>
          </span>
        </Link>
      ))}
    </nav>
  );
}
