"use client";

import { useEffect, useState } from "react";
import { choicesStore } from "../choices/choices-store";
import { checkOfflineSupport, type OfflineSupport } from "./support";

/**
 * Whether this phone keeps pages for reading without signal (support.ts checkOfflineSupport), or null until it is known.
 * R-34 says "This phone may not keep pages for offline use" when it is "limited".
 */
export function useOfflineSupport(lang: string): OfflineSupport | null {
  const [support, setSupport] = useState<OfflineSupport | null>(null);
  useEffect(() => {
    let live = true;
    let cacheStorage: CacheStorage | undefined;
    try {
      cacheStorage = typeof caches === "undefined" ? undefined : caches;
    } catch {
      cacheStorage = undefined;
    }
    void checkOfflineSupport({
      serviceWorker: "serviceWorker" in navigator ? navigator.serviceWorker : undefined,
      caches: cacheStorage,
      storageUsable: choicesStore.storageUsable(),
      estimate: navigator.storage?.estimate ? () => navigator.storage.estimate() : undefined,
      origin: window.location.origin,
      lang,
    }).then((result) => {
      if (live) setSupport(result);
    });
    return () => {
      live = false;
    };
  }, [lang]);
  return support;
}
