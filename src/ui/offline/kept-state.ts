"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { KEPT_AT_META } from "./protocol";

// What a page can tell about itself without signal (S02.12, S05.07): whether the browser says it has a connection, and when the service worker stored the copy of this document
// it was handed out from, written into the document itself as a <meta> (so it needs no worker to be running).

const subscribeOnline = (change: () => void) => {
  window.addEventListener("online", change);
  window.addEventListener("offline", change);
  return () => {
    window.removeEventListener("online", change);
    window.removeEventListener("offline", change);
  };
};

/** Whether the browser says it has a connection (true on the server and in the first render). */
export const useOnline = (): boolean => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

const never = () => () => {};

/** When the worker says the copy of this document was stored, from the <meta> it wrote into it (null when it did not). */
export function keptAtMeta(): number | null {
  const at = Number(document.querySelector(`meta[name="${KEPT_AT_META}"]`)?.getAttribute("content"));
  return Number.isFinite(at) && at > 0 ? at : null;
}

/** When the copy of this document the worker handed out was stored, or null when the network answered it (and always null on the server and in the first render). */
export const useKeptAt = (): number | null => useSyncExternalStore(never, keptAtMeta, () => null);

// The marker is in the head of the document the worker handed out, and the head outlives client-side moves, so it speaks for that document only: the path the app was loaded
// at, and only until signal has come back (after which the pages come from the server).
const loadedPath = typeof window === "undefined" ? null : window.location.pathname;
let signalBack = false;
if (typeof window !== "undefined") window.addEventListener("online", () => (signalBack = true));

/** Whether a kept-at marker still describes the page on screen: it is the document it was written into, and signal has not come back since. Pure (unit-tested). */
export const markerApplies = (input: { pathname: string; loadedPath: string | null; signalBack: boolean }): boolean => input.pathname === input.loadedPath && !input.signalBack;

/** The kept-at marker, only while it describes the page on screen (see markerApplies); null otherwise, and always null on the server and in the first render. */
export function useServedKeptAt(): number | null {
  const pathname = usePathname();
  const at = useKeptAt();
  useOnline(); // re-render when signal changes (signalBack is read below)
  return at !== null && markerApplies({ pathname, loadedPath, signalBack }) ? at : null;
}
