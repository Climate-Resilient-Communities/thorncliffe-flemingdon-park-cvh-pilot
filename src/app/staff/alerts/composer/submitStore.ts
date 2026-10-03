// The key of a press whose outcome the server never confirmed, kept in the tab's session storage (S04.05), so that a page that is loaded again
// (a reload, a restored tab) still sends the SAME key on the next press and cannot make a second version. It is a convenience of this tab,
// never the truth: the entry's state is on the server, and a key found here is checked against it first (`reconcile`). Every read and write
// is guarded: storage can be empty, full, blocked or missing (a private window, a preview), and the screen works the same without it.
import { SUBMIT_KEY_PATTERN } from "@/contracts/alertSubmit";
import type { Unconfirmed } from "./submitMachine";

export interface KeyStorage {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
}

const nameOf = (entryId: string) => `cvh.submit-key.${entryId}`;

/** The tab's session storage, or null where there is none or it cannot be reached. */
export function sessionKeyStorage(): KeyStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The key kept for this entry, if there is a well-formed one. */
export function readUnconfirmed(entryId: string, storage: KeyStorage | null = sessionKeyStorage()): Unconfirmed | null {
  try {
    const raw = storage?.getItem(nameOf(entryId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { key, kind } = parsed as { key?: unknown; kind?: unknown };
    if (typeof key !== "string" || !SUBMIT_KEY_PATTERN.test(key) || (kind !== "submit" && kind !== "retranslate")) return null;
    return { key, kind };
  } catch {
    return null;
  }
}

/** Keeps the key (or forgets it, for null). Never throws. */
export function writeUnconfirmed(entryId: string, value: Unconfirmed | null, storage: KeyStorage | null = sessionKeyStorage()): void {
  try {
    if (!storage) return;
    if (value === null) storage.removeItem(nameOf(entryId));
    else storage.setItem(nameOf(entryId), JSON.stringify({ key: value.key, kind: value.kind }));
  } catch {
    // The key is only a convenience of this tab.
  }
}

/**
 * The key to start from when the page loads: the one kept, unless the server already knows it. The page was made from the entry's latest
 * attempt, so when that attempt has the kept key, its outcome is on the screen (running, committed or failed) and the key is confirmed.
 */
export function reconcile(kept: Unconfirmed | null, latestAttemptKey: string | null): Unconfirmed | null {
  return kept !== null && kept.key === latestAttemptKey ? null : kept;
}
