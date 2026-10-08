"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A row's actions menu ("⋯"): the app's disclosure, a <details> whose <summary> is the button, so it opens with a click, Enter or Space
 * and works before the page is hydrated. Once hydrated: Escape closes it and puts focus back on its button, a press outside it or focus
 * moving out of it closes it, and so does sending one of its forms (focus then returns to the button, which stays in the page while the
 * row changes). The button's name says whose actions they are ("Actions for East York Food Bank"); its "⋯" is not read out.
 */
export function RowActions({ label, testId, children }: { label: string; testId?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  const close = (returnFocus: boolean) => {
    const details = ref.current;
    if (!details?.open) return;
    details.open = false;
    if (returnFocus) details.querySelector("summary")?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <details
      ref={ref}
      className="row-actions"
      data-testid={testId}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !ref.current?.open) return;
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close(false);
      }}
      onSubmit={() => close(true)}
    >
      <summary className="row-actions__button tap" aria-label={label}>
        <span aria-hidden="true">⋯</span>
      </summary>
      <div className="row-actions__panel">{children}</div>
    </details>
  );
}
