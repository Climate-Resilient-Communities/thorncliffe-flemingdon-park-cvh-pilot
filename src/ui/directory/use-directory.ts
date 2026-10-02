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
 * shows at once while the server is asked which release is current.
 */
export function useDirectory(lang: string): DirectoryState {
  const [state, setState] = useState<DirectoryState>({ status: "loading" });

  useEffect(() => {
    let live = true;
    void loadDirectory(lang, {
      storage: phoneStorage(),
      onKept: (kept) => {
        if (live) setState({ status: "ready", ...kept, current: true });
      },
    }).then((result) => {
      if (live) setState(result);
    });
    return () => {
      live = false;
    };
  }, [lang]);

  return state;
}
