import { describe, expect, it, vi } from "vitest";
import { createChoicesStore } from "../choices/choices-store";
import { saveLanguageChoice } from "./language-choice";

function memory(initial: Record<string, string> = {}) {
  const items = { ...initial };
  return {
    items,
    getItem: (key: string) => items[key] ?? null,
    setItem: (key: string, value: string) => void (items[key] = value),
    removeItem: (key: string) => void delete items[key],
  };
}

const saved = (storage: ReturnType<typeof memory>) => JSON.parse(storage.items["cvh.choices"]);

describe("saveLanguageChoice", () => {
  it("saves the language under cvh.choices as {v: 1, lang}, stamped with the time of the write", () => {
    const storage = memory();

    expect(saveLanguageChoice("ur", createChoicesStore(() => storage, undefined, () => 1234))).toBe(true);
    expect(saved(storage)).toEqual({ v: 1, lang: "ur", savedAt: 1234 });
  });

  it("keeps the other choices that are saved", () => {
    const storage = memory({ "cvh.choices": '{"v":1,"lang":"en","buildings":["7"]}' });

    saveLanguageChoice("fr", createChoicesStore(() => storage));

    expect(saved(storage)).toMatchObject({ v: 1, lang: "fr", buildings: ["7"] });
  });

  it("replaces a corrupt value instead of failing", () => {
    const storage = memory({ "cvh.choices": "{broken" });

    expect(saveLanguageChoice("ta", createChoicesStore(() => storage))).toBe(true);
    expect(saved(storage)).toMatchObject({ v: 1, lang: "ta" });
  });

  it("writes through the choices store, so the screens that show the choices hear it", () => {
    const storage = memory();
    const store = createChoicesStore(() => storage);
    const heard = vi.fn();
    store.subscribe(heard);

    saveLanguageChoice("es", store);

    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toMatchObject({ lang: "es" });
  });

  it("returns false and does not throw when storage is missing or refuses", () => {
    const refusing = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };

    expect(saveLanguageChoice("ur", createChoicesStore(() => undefined))).toBe(false);
    expect(saveLanguageChoice("ur", createChoicesStore(() => refusing))).toBe(false);
  });
});
