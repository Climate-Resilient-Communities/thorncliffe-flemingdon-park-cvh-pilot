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

    expect(createChoicesStore(() => storage).getSnapshot()).toBeNull();
  });

  it("saves under cvh.choices and reads it back", () => {
    const storage = memoryStorage();
    const store = createChoicesStore(() => storage);

    expect(store.update((current) => ({ ...baseChoices(current), lang: "ur", buildings: ["100"] }))).toBe(true);

    expect(JSON.parse(storage.items.get(DEVICE_CHOICES_KEY)!)).toEqual({ v: 1, lang: "ur", buildings: ["100"] });
    expect(store.getSnapshot()).toEqual({ v: 1, lang: "ur", buildings: ["100"] });
  });

  it("keeps fields it does not know when it changes another", () => {
    const storage = memoryStorage({ [DEVICE_CHOICES_KEY]: '{"v":1,"basic":true,"muted":["heat"]}' });
    const store = createChoicesStore(() => storage);

    store.update((current) => ({ ...baseChoices(current), groups: ["seniors"] }));

    expect(store.getSnapshot()).toEqual({ v: 1, basic: true, muted: ["heat"], groups: ["seniors"] });
  });

  it("hands out the same object until the saved text changes", () => {
    const storage = memoryStorage({ [DEVICE_CHOICES_KEY]: '{"v":1}' });
    const store = createChoicesStore(() => storage);
    const first = store.getSnapshot();

    expect(store.getSnapshot()).toBe(first);
    storage.items.set(DEVICE_CHOICES_KEY, '{"v":1,"lang":"fr"}');
    expect(store.getSnapshot()).not.toBe(first);
  });

  it.each(["not json", "[]", "null", '{"v":2}', '{"v":1,"lang":"xx"}', '{"v":1,"buildings":[7]}', '{"v":1,"floors":["not-a-uuid"]}', '{"v":1,"groups":["pirates"]}'])(
    "reads %j as a first visit, never throws, and the next change replaces it",
    (raw) => {
      const storage = memoryStorage({ [DEVICE_CHOICES_KEY]: raw });
      const store = createChoicesStore(() => storage);

      expect(store.getSnapshot()).toBeNull();
      store.update((current) => ({ ...baseChoices(current), lang: "en" }));
      expect(JSON.parse(storage.items.get(DEVICE_CHOICES_KEY)!)).toEqual({ v: 1, lang: "en" });
    },
  );

  it("writes nothing when a change returns the choices it was given", () => {
    const storage = memoryStorage({ [DEVICE_CHOICES_KEY]: '{"v":1,"lang":"ur"}' });
    const setItem = vi.spyOn(storage, "setItem");
    const store = createChoicesStore(() => storage);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.update((current) => current)).toBe(true);

    expect(setItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("clear removes cvh.choices", () => {
    const storage = memoryStorage({ [DEVICE_CHOICES_KEY]: '{"v":1,"lang":"ur"}', other: "kept" });
    const store = createChoicesStore(() => storage);

    expect(store.clear()).toBe(true);

    expect(storage.items.has(DEVICE_CHOICES_KEY)).toBe(false);
    expect(storage.items.get("other")).toBe("kept");
    expect(store.getSnapshot()).toBeNull();
  });

  it("treats a missing storage as no choices and keeps choices for the open session", () => {
    const store = createChoicesStore(() => undefined);

    expect(store.getSnapshot()).toBeNull();
    expect(store.update((current) => ({ ...baseChoices(current), groups: ["families"] }))).toBe(false);
    expect(store.getSnapshot()).toEqual({ v: 1, groups: ["families"] });
    store.clear();
    expect(store.getSnapshot()).toBeNull();
  });

  it("never throws when the storage throws, and keeps the session's choices", () => {
    const store = createChoicesStore(() => refusing());

    expect(store.getSnapshot()).toBeNull();
    expect(store.update((current) => ({ ...baseChoices(current), welcomed: true }))).toBe(false);
    expect(store.getSnapshot()).toEqual({ v: 1, welcomed: true });
    expect(store.clear()).toBe(false);
    expect(store.getSnapshot()).toBeNull();
  });

  it("never throws when reading the storage property itself throws", () => {
    const store = createChoicesStore(() => {
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
    const store = createChoicesStore(() => storage);

    store.update((current) => ({ ...baseChoices(current), lang: "ur" }));

    expect(store.getSnapshot()).toEqual({ v: 1, lang: "ur" });
  });

  it("tells listeners about a change, and stops after they unsubscribe", () => {
    const storage = memoryStorage();
    const store = createChoicesStore(() => storage);
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
    const store = createChoicesStore(() => storage, hear);
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);
    expect(hear).toHaveBeenCalledWith(listener);
    unsubscribe();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
