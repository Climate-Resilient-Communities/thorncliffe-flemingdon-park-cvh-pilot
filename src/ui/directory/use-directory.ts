"use client";

import { useEffect, useState } from "react";
import { loadDirectory, type DirectoryState, type KeptStorage } from "./load-directory";

/** The phone's own storage, or null when it is blocked (a private window, cleared site data). */
function phoneStorage(): KeptStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The directory in `lang`, read from the published release files (load-directory.ts). A listing kept from an earlier visit
 * shows at once, as not current, while the server is asked which release is current; it is asked again when signal comes
 * back and when the page becomes visible.
 */
export function useDirectory(lang: string): DirectoryState {
  const [state, setState] = useState<DirectoryState>({ status: "loading" });

  useEffect(() => {
    let live = true;
    let run = 0;
    const load = () => {
      const mine = ++run;
      void loadDirectory(lang, {
        storage: phoneStorage(),
        // The kept listing shows at once, but not as current: only the manifest says that.
        onKept: (kept) => {
          if (live && mine === run) setState((shown) => (shown.status === "ready" && shown.current ? shown : kept));
        },
      }).then((result) => {
        if (live && mine === run) setState(result);
      });
    };
    // S02.12: when signal comes back or the page is seen again, the manifest is asked at once and "Last updated" follows.
    const again = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      live = false;
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [lang]);

  return state;
}
