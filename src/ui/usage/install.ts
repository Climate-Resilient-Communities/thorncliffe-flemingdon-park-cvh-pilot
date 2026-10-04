import type { NeighbourhoodId } from "@/contracts/directory";
import type { LangCode } from "@/contracts/lang";
import type { UsageEvent } from "@/contracts/usage";

// The install event (S02.15, FR-M1): sent once when the browser says the app was installed (`appinstalled`), or, where it
// does not say so, the first time the app is opened as an installed one (standalone display mode). A local flag, true or
// absent and nothing else, stops this phone sending it again. These are "install events observed", not unique
// installations: a reinstall or cleared storage counts again, and a browser that reports neither signal is not counted.

/** The localStorage key of the flag. Its value is the text "1": a yes, not an identifier. */
export const INSTALL_FLAG_KEY = "cvh.install-reported";

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type InstallOutcome =
  /** The event was sent and counted. */
  | "sent"
  /** This phone has already sent one. */
  | "already"
  /** No signal: dropped, not queued. The next standalone open tries again, since the flag was not set. */
  | "offline"
  /** The phone cannot keep the flag, so a second event could not be stopped: nothing is sent. */
  | "no-flag"
  /** The server did not count it; the flag is taken back so the next open tries again. */
  | "failed";

export interface InstallDeps {
  storage: FlagStorage | null;
  online: () => boolean;
  /** The one neighbourhood the chosen buildings are all in, if there is one. Called only once an event is going to be sent. */
  neighbourhood: () => Promise<NeighbourhoodId | undefined>;
  send: (event: UsageEvent) => Promise<boolean>;
}

/** Sends the install event unless this phone has sent it. The flag is set before anything is awaited, so two signals at once send one event. */
export async function reportInstall(lang: LangCode, deps: InstallDeps): Promise<InstallOutcome> {
  const { storage } = deps;
  if (!storage) return "no-flag";
  try {
    if (storage.getItem(INSTALL_FLAG_KEY) === "1") return "already";
  } catch {
    return "no-flag";
  }
  if (!deps.online()) return "offline";
  try {
    storage.setItem(INSTALL_FLAG_KEY, "1");
  } catch {
    return "no-flag";
  }
  const nbhd = await deps.neighbourhood().catch(() => undefined);
  const counted = await deps.send(nbhd === undefined ? { evt: "install", lang } : { evt: "install", lang, nbhd });
  if (counted) return "sent";
  try {
    storage.removeItem(INSTALL_FLAG_KEY);
  } catch {
    // The flag stays: this phone will not try again, and one install is missed.
  }
  return "failed";
}

/** True when the app is open as an installed one (a window of its own), by the standard media query or iOS's flag. */
export function isStandalone(win: { matchMedia: (query: string) => { matches: boolean }; navigator: object }): boolean {
  try {
    return win.matchMedia("(display-mode: standalone)").matches || (win.navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}
