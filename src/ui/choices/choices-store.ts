import { DEVICE_CHOICES_KEY, parseDeviceChoices, type DeviceChoices } from "@/contracts/deviceChoices";

/** The part of Storage the store uses. */
export type ChoicesStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** What the store knows: `null` is "no choices" (missing, unreadable or invalid), the same as a first visit. */
export type ChoicesSnapshot = DeviceChoices | null;

/** The base for a change: what is saved, or a fresh `{v: 1}`. */
export const baseChoices = (current: ChoicesSnapshot): DeviceChoices => ({ ...current, v: 1 });

export interface ChoicesStore {
  /** The saved choices as of now. The same object until the saved text changes (for useSyncExternalStore). */
  getSnapshot(): ChoicesSnapshot;
  /**
   * Replaces the choices with what `change` returns from the current ones (null: remove them all; the same object: no change, nothing written). Never throws.
   * Returns false when the phone refused to keep it: the choice then lives for this open session only.
   */
  update(change: (current: ChoicesSnapshot) => ChoicesSnapshot): boolean;
  /** Removes `cvh.choices`. Same promise as update. */
  clear(): boolean;
  /** Calls back after any change here or in another tab. Returns the way to stop. */
  subscribe(listener: () => void): () => void;
}

/**
 * The resident's choices on their phone (AD-3, `cvh.choices` in localStorage), read and written in one place.
 *
 * Storage that is missing, blocked or throwing (private mode, quota, a policy) is never an error: reading it gives "no
 * choices", and a write that fails is kept in memory so the app still works for the open session. A value that is
 * not JSON, or fails the schema, reads as no choices and is replaced by the next write. Nothing here touches the network.
 *
 * @param getStorage the phone's localStorage, or undefined where even reading the property throws
 * @param onChange how other tabs are heard (the window's `storage` event); omitted where there is no window
 */
export function createChoicesStore(
  getStorage: () => ChoicesStorage | undefined,
  onChange?: (notify: () => void) => () => void,
): ChoicesStore {
  // undefined: the storage is the truth. A string or null: the last write the storage refused (null: cleared).
  let memory: string | null | undefined;
  let cache: { raw: string | null; value: ChoicesSnapshot } = { raw: null, value: null };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  function readRaw(): string | null {
    if (memory !== undefined) return memory;
    try {
      return getStorage()?.getItem(DEVICE_CHOICES_KEY) ?? null;
    } catch {
      return null;
    }
  }

  function getSnapshot(): ChoicesSnapshot {
    const raw = readRaw();
    if (raw !== cache.raw) cache = { raw, value: parseDeviceChoices(raw) };
    return cache.value;
  }

  function write(raw: string | null): boolean {
    let kept = true;
    try {
      const storage = getStorage();
      if (!storage) throw new Error("no storage");
      if (raw === null) storage.removeItem(DEVICE_CHOICES_KEY);
      else storage.setItem(DEVICE_CHOICES_KEY, raw);
      memory = undefined;
    } catch {
      memory = raw;
      kept = false;
    }
    notify();
    return kept;
  }

  return {
    getSnapshot,
    update(change) {
      const current = getSnapshot();
      const next = change(current);
      if (next === current) return true;
      return write(next === null ? null : JSON.stringify(next));
    },
    clear() {
      return write(null);
    },
    subscribe(listener) {
      listeners.add(listener);
      const stopHearing = onChange?.(listener);
      return () => {
        listeners.delete(listener);
        stopHearing?.();
      };
    },
  };
}

/** The phone's localStorage, or undefined where reading the property itself throws. */
function phoneStorage(): ChoicesStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function hearOtherTabs(notify: () => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === null || event.key === DEVICE_CHOICES_KEY) notify();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

/** The store the resident screens share. */
export const choicesStore: ChoicesStore = createChoicesStore(phoneStorage, typeof window === "undefined" ? undefined : hearOtherTabs);
