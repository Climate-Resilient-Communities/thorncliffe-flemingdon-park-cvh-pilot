"use client";

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
