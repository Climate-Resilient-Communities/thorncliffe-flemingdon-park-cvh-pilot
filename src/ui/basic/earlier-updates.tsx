"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * R-07 in basic mode (the prototype's `showAllThread`): only the latest entry of the thread is shown, and "Earlier updates: n"
 * brings the rest. The thread is rendered in full by the server, so a page in normal size and a page without script show every
 * entry; basic.css hides the entries marked `basic-earlier__item` and shows the button only under `<html data-basic>`. In
 * normal size the button is not displayed, so a screen reader does not meet it. When the button is used it goes, so focus moves
 * to the first entry it brought, and a screen reader reads on from there.
 */
export function EarlierUpdates({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [all, setAll] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (!all || !opened.current) return;
    const first = root.current?.querySelector<HTMLElement>(".basic-earlier__item");
    first?.setAttribute("tabindex", "-1");
    first?.focus();
  }, [all]);

  return (
    <div className="basic-earlier" data-all={all} data-testid="alert-earlier" ref={root}>
      {children}
      {!all && (
        <button
          type="button"
          className="basic-earlier__more tap"
          onClick={() => {
            opened.current = true;
            setAll(true);
          }}
          data-testid="alert-earlier-more"
        >
          {label}
        </button>
      )}
    </div>
  );
}
