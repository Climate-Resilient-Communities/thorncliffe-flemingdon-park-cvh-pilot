"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { agoText } from "../home/feed-poll";
import { ResidentText } from "../text/resident-text";
import { useKeptAt, useOnline } from "./kept-state";
import { SW_SCOPE, SW_URL, type PageMessage } from "./protocol";
import { askPersistOnce, askServed, keptAt } from "./support";

function phoneStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Registers the service worker once per page load, in a production build only (in development it would hide changes). */
function registerWorker(): void {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register(SW_URL, { scope: SW_SCOPE })
    .then(() => askPersistOnce(phoneStorage(), navigator.storage))
    .catch(() => {
      // No worker (blocked, a private window, no storage): the CVH keeps working online.
    });
}

// Its stylesheet (offline.css) comes with globals.css, like the shell's: the layout draws it, and a stylesheet the layout
// imported before globals.css would declare the `components` layer before Tailwind's layer order.

/**
 * Offline reading for every resident page (S02.12), mounted once by the resident layout. It registers the service worker,
 * asks once for storage that is kept, tells the worker about each page the resident moves to without loading a document (a
 * Next link) so that page is kept too, and, while the phone has no signal or the page on screen is a kept copy, says so and
 * since when: "You are offline. Showing what was last loaded {time}". Nothing here reaches the server.
 */
export function OfflineSupport() {
  const shell = useTranslations("shell");
  const time = useTranslations("time");
  const pathname = usePathname();
  const online = useOnline();
  const first = useRef(true);
  // When the copy on screen was stored: as the worker answered this document from its cache, or as it is kept now.
  const [served, setServed] = useState<{ path: string; at: number } | null>(null);
  const [kept, setKept] = useState<{ path: string; at: number | null } | null>(null);
  const [now, setNow] = useState(0);
  // The document itself says whether the worker handed it out from its cache (a timeout, a server error or no signal), so the note
  // does not depend on a worker that the browser may have stopped meanwhile. Only the document the app was loaded with carries it.
  const [loadedAt] = useState(pathname);
  const [signalBack, setSignalBack] = useState(false);
  const writtenAt = useKeptAt();

  useEffect(() => {
    registerWorker();
  }, []);

  useEffect(() => {
    const isFirst = first.current;
    first.current = false;
    if (!("serviceWorker" in navigator)) return;
    const controller = navigator.serviceWorker.controller;
    let live = true;
    if (isFirst) {
      // A document load: the worker knows whether it answered from its cache.
      void askServed(controller).then((at) => {
        if (live && at !== null) setServed({ path: pathname, at });
      });
    } else if (controller && navigator.onLine) {
      // A move inside the app: the worker fetches and keeps this page as a document, as it does for a document load.
      const message: PageMessage = { type: "cvh:keep-page", path: pathname };
      controller.postMessage(message);
    }
    return () => {
      live = false;
    };
  }, [pathname]);

  // Signal back: the note goes. The feed and the directory ask the server again themselves (use-feed.ts, use-directory.ts).
  useEffect(() => {
    const back = () => {
      setServed(null);
      setSignalBack(true);
    };
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, []);

  // Without signal: when the kept copy of this page was stored, for the note.
  useEffect(() => {
    if (online) return;
    let live = true;
    void keptAt(typeof caches === "undefined" ? undefined : caches, window.location.origin, pathname).then((at) => {
      if (live) setKept({ path: pathname, at });
    });
    return () => {
      live = false;
    };
  }, [online, pathname]);

  const servedHere = served?.path === pathname ? served.at : pathname === loadedAt && !signalBack ? writtenAt : null;
  const showing = !online || servedHere !== null;
  useEffect(() => {
    if (!showing) return;
    const tick = () => setNow(Date.now());
    const soon = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(soon);
      clearInterval(timer);
    };
  }, [showing]);

  const translate = ((key: string, values?: Record<string, string | number>) => time(key, values)) as Parameters<typeof agoText>[1];
  // With no kept copy to date it (no worker), the page is as old as the document it was drawn in.
  const since = servedHere ?? (kept?.path === pathname ? kept.at : null) ?? (typeof performance === "undefined" ? now : performance.timeOrigin);
  // One live region, always mounted (and empty, so of no height, while there is signal), so a screen reader hears the note.
  return (
    <div role="status" data-testid="offline-status">
      {showing && (
        <div className="offline-note" data-testid="offline-note">
          <ResidentText as="p">{shell("offline", { t: agoText(now - since, translate) })}</ResidentText>
        </div>
      )}
    </div>
  );
}
