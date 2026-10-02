import type { ReactNode } from "react";

export const HUB_NAV_ICONS = ["now", "pencil", "inbox", "person", "phone"] as const;

export type HubNavIcon = (typeof HUB_NAV_ICONS)[number];

export type HubNavItem = {
  id: string;
  label: string;
  /** Where it goes; null for a page that is not built yet, listed as a disabled link: dimmed, not focusable, announced as unavailable. */
  href: string | null;
  /** True for the Hub's home: only that exact path is current, not every page below it. */
  exact?: boolean;
  icon: HubNavIcon;
};

export type HubNavSection = {
  id: string;
  label: string;
  items: readonly HubNavItem[];
};

export type HubNavProps = {
  sections: readonly HubNavSection[];
  /** The path of the page being shown; the item whose page it is announces itself as the current page. */
  currentPath: string | null;
};

/** The item whose page this is: the exact path, or (unless `exact`) a page below it. */
export function isCurrentPage(currentPath: string | null, item: Pick<HubNavItem, "href" | "exact">): boolean {
  if (currentPath === null || item.href === null) return false;
  const path = currentPath.length > 1 ? currentPath.replace(/\/+$/, "") : currentPath;
  return path === item.href || (!item.exact && path.startsWith(`${item.href}/`));
}

/**
 * The Hub's destinations in sections (C_HubSide): real links, so they work before any script runs and every
 * move is a full page load, which also re-reads what the layout shows. Rendered twice by the shell, in the side
 * navigation and in the menu drawer; only one is ever displayed.
 */
export function HubNav({ sections, currentPath }: HubNavProps): ReactNode {
  return sections.map((section) => (
    <div className="hub-nav__section" key={section.id}>
      <p className="hub-nav__heading">{section.label}</p>
      <ul className="hub-nav__list" role="list">
        {section.items.map((item) => (
          <li key={item.id}>
            {item.href === null ? (
              // The disabled-link pattern: a link role with aria-disabled and no href, so a screen reader announces the
              // item as an unavailable link, and with no tabindex it is not in the tab order.
              <span className="hub-nav__item hub-nav__item--unbuilt" role="link" aria-disabled="true" data-testid={`hub-nav-${item.id}`}>
                <span className={`hub-ico hub-ico--${item.icon}`} aria-hidden="true" />
                <span className="hub-nav__label">{item.label}</span>
              </span>
            ) : (
              <a
                className="hub-nav__item tap"
                href={item.href}
                aria-current={isCurrentPage(currentPath, item) ? "page" : undefined}
                data-testid={`hub-nav-${item.id}`}
              >
                <span className={`hub-ico hub-ico--${item.icon}`} aria-hidden="true" />
                <span className="hub-nav__label">{item.label}</span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  ));
}
