"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import type { LaunchCode } from "@/i18n/languages";
import { BuildingListContext } from "./building-list-context";
import { gatePhase } from "./gate-phase";
import { useBuildingList, useChoices, useReconcileChoices, useStorageUsable } from "./use-choices";
import "./choices.css";

/**
 * Wraps home. A first visit (no valid `cvh.choices`, or the first-run steps not yet gone through) is sent to R-01
 * before anything else; the home content is hidden for the moment before that screen opens. Once the phone says the
 * visit is not a first one, the building list is loaded (the same request for every resident) and the saved buildings
 * and floors are checked against it, so a building or floor that is gone is dropped from the choices (S02.03).
 *
 * When the phone keeps nothing (blocked storage), nobody is sent anywhere: every visit would be a first one. Home is
 * shown, and its link to "What I have told the CVH" is the way to the steps.
 *
 * The loaded list is shared with the screen inside (BuildingListContext), so home does not ask for it again.
 *
 * The phone is only read after the page has loaded; until then, and without script, the page is shown as it came.
 */
export function FirstRunGate({ lang, children }: { lang: LaunchCode; children: ReactNode }) {
  const router = useRouter();
  const choices = useChoices();
  const storageUsable = useStorageUsable();
  const phase = gatePhase(choices, storageUsable);

  useEffect(() => {
    if (phase === "redirecting") router.replace(`/${lang}/welcome`);
  }, [phase, lang, router]);

  const { state } = useBuildingList(phase === "ready");
  useReconcileChoices(state);

  return (
    <div className="first-run-gate" data-state={phase} data-testid="first-run-gate">
      <BuildingListContext.Provider value={state}>{children}</BuildingListContext.Provider>
    </div>
  );
}
