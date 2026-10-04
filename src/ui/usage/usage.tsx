"use client";

import { useEffect } from "react";
import type { NeighbourhoodId } from "@/contracts/directory";
import type { LangCode } from "@/contracts/lang";
import type { UsageEventName } from "@/contracts/usage";
import { loadBuildingList } from "../choices/building-list";
import { choicesStore } from "../choices/choices-store";
import { isStandalone, reportInstall } from "./install";
import { installNeighbourhood } from "./nbhd";
import { sendUsage } from "./send";

function phoneStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Counts one view when the page it is on opens (S02.15): `evt` in the page's language, and `nbhd` only when the page is about
 * one neighbourhood. `ready` holds the count back until the page knows what it is showing (a listing is counted once it is
 * found). Renders nothing; sends nothing the contract does not allow.
 */
export function UsageView({ evt, lang, nbhd, ready = true }: { evt: Exclude<UsageEventName, "install">; lang: LangCode; nbhd?: NeighbourhoodId; ready?: boolean }) {
  useEffect(() => {
    if (!ready) return;
    void sendUsage(nbhd === undefined ? { evt, lang } : { evt, lang, nbhd });
  }, [evt, lang, nbhd, ready]);
  return null;
}

/** The neighbourhood of the chosen buildings, asked for only when an install event is about to be sent, and only if buildings are chosen. */
async function chosenNeighbourhood(): Promise<NeighbourhoodId | undefined> {
  const buildings = choicesStore.getSnapshot()?.buildings;
  if (!buildings || buildings.length === 0) return undefined;
  return installNeighbourhood(buildings, await loadBuildingList());
}

/**
 * Counts installs (S02.15, FR-M1), mounted once by the resident layout: when the browser reports `appinstalled`, or when the app is
 * opened as an installed one, one `install` event is sent and a flag on the phone stops it being sent again. Renders nothing.
 */
export function InstallCount({ lang }: { lang: LangCode }) {
  useEffect(() => {
    const report = () =>
      void reportInstall(lang, {
        storage: phoneStorage(),
        online: () => navigator.onLine !== false,
        neighbourhood: chosenNeighbourhood,
        send: (event) => sendUsage(event, { keepalive: true }),
      });
    if (isStandalone(window)) report();
    window.addEventListener("appinstalled", report);
    return () => window.removeEventListener("appinstalled", report);
  }, [lang]);
  return null;
}
