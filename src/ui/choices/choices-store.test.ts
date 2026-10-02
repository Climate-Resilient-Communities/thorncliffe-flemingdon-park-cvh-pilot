import { describe, expect, it, vi } from "vitest";
import { DEVICE_CHOICES_KEY } from "@/contracts/deviceChoices";
import { baseChoices, createChoicesStore, type ChoicesStorage } from "./choices-store";

/** A phone's storage held in a Map. */
function memoryStorage(initial: Record<string, string> = {}): ChoicesStorage & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/** The clock that stamps savedAt. */
const NOW = 1_700_000_000_000;
const make = (getStorage: Parameters<typeof createChoicesStore>[0], onChange?: Parameters<typeof createChoicesStore>[1]) => createChoicesStore(getStorage, onChange, () => NOW);

const refusing = (): ChoicesStorage => ({
  getItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("full", "QuotaExceededError");
  },
  removeItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
});

describe("choices store", () => {
  it("reads no choices when nothing is saved", () => {
    const storage = memoryStorage();

    expect(make(() => storage).getSnapshot()).toBeNull();
  });

  it("saves under cvh.choices and reads it back", () => {
    const storage = memoryStorage();
    const store = make(() => storage);

    expect(store.update((current) => ({ ...baseChoices(current), lang: "ur", buildings: ["100"] }))).toBe(true);

    expect(JSON.parse(storage.items.get(DEVICE_CHOICES_KEY)!)).toEqual({ v: 1, lang: "ur", buildings: ["100"], savedAt: NOW });
    expect(store.getSnapshot()).toEqual({ v: 1, lang: "ur", buildings: ["100"], savedAt: NOW });
  });

  it("keeps fields it does not know when it changes another", () => {
    const storage = memoryStorage({ [DEVICE_CHOICES_KEY]: '{"v":1,"basic":true,"muted":["heat"]}' });
    const store = make(() => storage);

    store.update((current) => ({ ...baseChoices(current), groups: ["seniors"] }));

    expect(store.getSnapshot()).toEqual({ v: 1, basic: true, muted: ["heat"], groups: ["seniors"], savedAt: NOW });
  });

  it("hands out the same object until the saved text changes", () => {
    const storage = memoryStorage({ [DEVICE_CHOICES_KEY]: '{"v":1}' });
    const store = make(() => storage);
    const first = store.getSnapshot();

    expect(store.getSnapshot()).toBe(first);
    storage.items.set(DEVICE_CHOICES_KEY, '{"v":1,"lang":"fr"}');
    expect(store.getSnapshot()).not.toBe(first);
  });

  it("reads a value with one bad field as the rest of it, and keeps the rest when it writes", () => {
    const storage = memoryStorage({ [DEVICE_CHOICES_KEY]: '{"v":1,"lang":"ur","welcomed":true,"buildings":[7],"groups":["seniors","pirates"]}' });
    const store = make(() => storage);

    expect(store.getSnapshot()).toEqual({ v: 1, lang: "ur", welcomed: true, groups: ["seniors"] });
    store.update((current) => ({ ...baseChoices(current), floors: [] }));
    expect(JSON.parse(storage.items.get(DEVICE_CHOICES_KEY)!)).toEqual({ v: 1, lang: "ur", welcomed: true, groups: ["seniors"], floors: [], savedAt: NOW });
  });

  it("stamps savedAt on every write, and a change that writes nothing does not", () => {
    let clock = 100;
    const storage = memoryStorage();
    const store = createChoicesStore(() => storage, undefined, () => clock);

    store.update((current) => ({ ...baseChoices(current), lang: "fr" }));
    expect(store.getSnapshot()?.savedAt).toBe(100);
    clock = 250;
    store.update((current) => current);
    expect(store.getSnapshot()?.savedAt).toBe(100);
    store.update((current) => ({ ...baseChoices(current), lang: "es" }));
    expect(store.getSnapshot()?.savedAt).toBe(250);
  });

  it("stamps the time of the write over a savedAt that came in with the change", () => {
    const storage = memoryStorage({ [DEVICE_CHOICES_KEY]: '{"v":1,"savedAt":5}' });
    const store = make(() => storage);

    store.update((current) => ({ ...baseChoices(current), welcomed: true }));

    expect(store.getSnapshot()).toEqual({ v: 1, welcomed: true, savedAt: NOW });
  });

  describe("storageUsable", () => {
    it("is true when a probe write is kept, and leaves nothing behind", () => {
      const storage = memoryStorage();
      const setItem = vi.spyOn(storage, "setItem");

      expect(make(() => storage).storageUsable()).toBe(true);

      expect(setItem).toHaveBeenCalledTimes(1);
      expect([...storage.items.keys()]).toEqual([]);
    });

    it("is false when the probe write is refused, or there is no storage at all", () => {
      expect(make(() => refusing()).storageUsable()).toBe(false);
      expect(make(() => undefined).storageUsable()).toBe(false);
      expect(
        make(() => {
          throw new Error("denied");
        }).storageUsable(),
      ).toBe(false);
    });

    it("is probed once, then follows the writes: a refused write makes it false, a kept one true", () => {
      const storage = memoryStorage();
      let full = false;
      const set = storage.setItem;
      storage.setItem = (key, value) => {
        if (full) throw new DOMException("full", "QuotaExceededError");
        set(key, value);
      };
      const spy = vi.spyOn(storage, "setItem");
      const store = make(() => storage);

      expect(store.storageUsable()).toBe(true);
      expect(store.storageUsable()).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);

      full = true;
      store.update((current) => ({ ...baseChoices(current), lang: "ur" }));
      expect(store.storageUsable()).toBe(false);

      full = false;
      store.update((current) => ({ ...baseChoices(current), lang: "en" }));
      expect(store.storageUsable()).toBe(true);
    });
  });

  it.each(["not json", "[]", "null", '{"v":2}', '{"lang":"ur"}'])(
    "reads %j as a first visit, never throws, and the next change replaces it",
    (raw) => {
      const storage = memoryStorage({ [DEVICE_CHOICES_KEY]: raw });
      const store = make(() => storage);

      expect(store.getSnapshot()).toBeNull();
      store.update((current) => ({ ...baseChoices(current), lang: "en" }));
      expect(JSON.parse(storage.items.get(DEVICE_CHOICES_KEY)!)).toEqual({ v: 1, lang: "en", savedAt: NOW });
    },
  );

  it("writes nothing when a change returns the choices it was given", () => {
    const storage = memoryStorage({ [DEVICE_CHOICES_KEY]: '{"v":1,"lang":"ur"}' });
    const setItem = vi.spyOn(storage, "setItem");
    const store = make(() => storage);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.update((current) => current)).toBe(true);

    expect(setItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("clear removes cvh.choices", () => {
    const storage = memoryStorage({ [DEVICE_CHOICES_KEY]: '{"v":1,"lang":"ur"}', other: "kept" });
    const store = make(() => storage);

    expect(store.clear()).toBe(true);

    expect(storage.items.has(DEVICE_CHOICES_KEY)).toBe(false);
    expect(storage.items.get("other")).toBe("kept");
    expect(store.getSnapshot()).toBeNull();
  });

  it("treats a missing storage as no choices and keeps choices for the open session", () => {
    const store = make(() => undefined);

    expect(store.getSnapshot()).toBeNull();
    expect(store.update((current) => ({ ...baseChoices(current), groups: ["families"] }))).toBe(false);
    expect(store.getSnapshot()).toEqual({ v: 1, groups: ["families"], savedAt: NOW });
    store.clear();
    expect(store.getSnapshot()).toBeNull();
  });

  it("never throws when the storage throws, and keeps the session's choices", () => {
    const store = make(() => refusing());

    expect(store.getSnapshot()).toBeNull();
    expect(store.update((current) => ({ ...baseChoices(current), welcomed: true }))).toBe(false);
    expect(store.getSnapshot()).toEqual({ v: 1, welcomed: true, savedAt: NOW });
    expect(store.clear()).toBe(false);
    expect(store.getSnapshot()).toBeNull();
  });

  it("never throws when reading the storage property itself throws", () => {
    const store = make(() => {
      throw new Error("denied");
    });

    expect(store.getSnapshot()).toBeNull();
    expect(() => store.update(() => ({ v: 1 }))).not.toThrow();
  });

  it("prefers a value the storage refused over the older one it still holds", () => {
    const storage = memoryStorage({ [DEVICE_CHOICES_KEY]: '{"v":1,"lang":"en"}' });
    storage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    const store = make(() => storage);

    store.update((current) => ({ ...baseChoices(current), lang: "ur" }));

    expect(store.getSnapshot()).toEqual({ v: 1, lang: "ur", savedAt: NOW });
  });

  it("tells listeners about a change, and stops after they unsubscribe", () => {
    const storage = memoryStorage();
    const store = make(() => storage);
    const listener = vi.fn();
    const stop = store.subscribe(listener);

    store.update((current) => ({ ...baseChoices(current), lang: "es" }));
    store.clear();
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    store.update(() => ({ v: 1 }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("hears another tab and lets go of it when the listener leaves", () => {
    const stop = vi.fn();
    const hear = vi.fn(() => stop);
    const storage = memoryStorage();
    const store = make(() => storage, hear);
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);
    expect(hear).toHaveBeenCalledWith(listener);
    unsubscribe();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
