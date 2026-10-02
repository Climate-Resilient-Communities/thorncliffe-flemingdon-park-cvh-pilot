"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { BuildingList } from "@/contracts/buildingList";
import { loadBuildingList } from "./building-list";
import { choicesStore, type ChoicesSnapshot } from "./choices-store";
import { reconcileChoices } from "./reconcile";

const unknown = (): undefined => undefined;

/** The saved choices: undefined until the phone has been read (the server and the first render), then the choices or null (a first visit). */
export function useChoices(): ChoicesSnapshot | undefined {
  return useSyncExternalStore(choicesStore.subscribe, choicesStore.getSnapshot, unknown);
}

export type BuildingListState = { status: "loading" } | { status: "failed" } | { status: "ready"; list: BuildingList };

/** The building list, loaded when `enabled`. `retry` asks again after a failure. */
export function useBuildingList(enabled = true): { state: BuildingListState; retry: () => void } {
  const [state, setState] = useState<BuildingListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void loadBuildingList().then((list) => {
      if (current) setState(list ? { status: "ready", list } : { status: "failed" });
    });
    return () => {
      current = false;
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((count) => count + 1);
  }, []);
  return { state, retry };
}

/**
 * Checks the saved buildings and floors against the building list once it has loaded and saves the result, so a
 * building or floor that is gone is dropped and R-34 can say so (S02.03). Does nothing without choices, or without a list.
 */
export function useReconcileChoices(state: BuildingListState): void {
  useEffect(() => {
    if (state.status !== "ready") return;
    choicesStore.update((current) => (current === null ? null : reconcileChoices(current, state.list)));
  }, [state]);
}
