"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

export type HubMenuProps = {
  labels: { menu: string; close: string };
  /** The navigation shown in the drawer. */
  children: ReactNode;
};

/**
 * The menu button of a phone and the drawer it opens (HubApp's "Menu" overlay): a modal dialog from the inline
 * start edge holding the same navigation as the side navigation. Both the button and the drawer are hidden
 * where the side navigation shows (the hub: variant, in CSS); a drawer left open when the screen turns wide
 * is closed, so the page behind it is never left inert.
 */
export function HubMenu({ labels, children }: HubMenuProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const closeWhenSideNavigationShows = () => {
      if (dialog.current?.open && button.current && getComputedStyle(button.current).display === "none") dialog.current.close();
    };
    window.addEventListener("resize", closeWhenSideNavigationShows);
    return () => window.removeEventListener("resize", closeWhenSideNavigationShows);
  }, []);

  const onDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    // A click on the backdrop lands on the dialog element itself; following a link ends the menu.
    if (event.target === event.currentTarget || (event.target as Element).closest("a")) dialog.current?.close();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="hub-iconbtn hub-menu-button tap"
        aria-label={labels.menu}
        aria-haspopup="dialog"
        data-testid="hub-menu-button"
        onClick={() => dialog.current?.showModal()}
      >
        <span className="hub-ico hub-ico--menu" aria-hidden="true" />
      </button>
      <dialog ref={dialog} className="hub-drawer" aria-label={labels.menu} data-testid="hub-drawer" onClick={onDialogClick}>
        <div className="hub-drawer__head">
          <button type="button" className="hub-iconbtn tap" aria-label={labels.close} data-testid="hub-menu-close" onClick={() => dialog.current?.close()}>
            <span className="hub-ico hub-ico--close" aria-hidden="true" />
          </button>
        </div>
        {children}
      </dialog>
    </>
  );
}
