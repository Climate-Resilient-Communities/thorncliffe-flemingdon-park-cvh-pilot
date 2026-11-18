"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { GUIDE_PARTS, type GuidePart } from "./sections";

// One stage of a guide at a time (resident testing, session 2, #14: "too much scrolling under Be ready"), as the prototype's R-25 draws it:
// Before, During and After as tabs, the stage shown, a "Next" button to the following one, and in basic mode the first three steps with
// "Show all n steps". The address's hash names the stage (#before, #during, #after), so an alert's link to "During" still opens it, and the
// browser's back steps between stages. With no hash (or before the page has loaded) "Before" shows.

const subscribe = (change: () => void) => {
  window.addEventListener("hashchange", change);
  return () => window.removeEventListener("hashchange", change);
};
const hashPart = (): GuidePart | null => {
  let id = "";
  try {
    id = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return null;
  }
  return (GUIDE_PARTS as readonly string[]).includes(id) ? (id as GuidePart) : null;
};

/** The stage on screen: the one the address names, else "Before". */
export function useGuideStage(): GuidePart {
  return useSyncExternalStore(subscribe, hashPart, () => null) ?? "before";
}

/** A stage's section: drawn for every stage (so the page reads without script), hidden unless it is the stage on screen. */
export function StagePanel({ part, children }: { part: GuidePart; children: ReactNode }) {
  const stage = useGuideStage();
  return <div hidden={stage !== part} data-stage-panel={part}>{children}</div>;
}

/** A tab of "Jump to": the link to the stage, marked as the current one when it is on screen. */
export function StageTab({ part, children }: { part: GuidePart; children: ReactNode }) {
  const stage = useGuideStage();
  return (
    <a href={`#${part}`} className="guide-jump__link tap" aria-current={stage === part ? "true" : undefined} data-testid={`guide-jump-${part}`}>
      {children}
    </a>
  );
}

/** In basic mode, the steps after the third behind "Show all n steps" (the prototype's cap); every step otherwise. */
export function StepsCap({ total, label, children }: { total: number; label: string; children: ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <div className="guide-cap" data-all={all || total <= 3 ? "true" : "false"}>
      {children}
      {!all && total > 3 && (
        <button type="button" className="guide-cap__more ready-link tap" onClick={() => setAll(true)} data-testid="guide-all-steps">
          {label}
        </button>
      )}
    </div>
  );
}
