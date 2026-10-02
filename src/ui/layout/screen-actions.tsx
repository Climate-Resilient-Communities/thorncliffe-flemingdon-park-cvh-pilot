"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { reserveActionsSpace } from "./actions-space";

export type ScreenActionsProps = {
  label: string;
  children: ReactNode;
};

/** Screen's sticky actions region; named for screen readers and kept clear of focused fields. */
export function ScreenActions({ label, children }: ScreenActionsProps) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => (region.current ? reserveActionsSpace(region.current) : undefined), []);
  return (
    <div ref={region} className="layout-screen__actions" role="region" aria-label={label}>
      {children}
    </div>
  );
}
