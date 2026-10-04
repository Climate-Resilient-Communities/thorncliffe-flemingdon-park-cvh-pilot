import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { DEVICE_CHOICES_KEY, parseDeviceChoices } from "@/contracts/deviceChoices";
import { createChoicesStore, type ChoicesStorage } from "../choices/choices-store";
import { applyBasic, BASIC_ATTRIBUTE, BASIC_BOOT_SCRIPT, isBasic, saveBasicChoice } from "./basic-mode";

function memoryStorage(initial: Record<string, string> = {}): ChoicesStorage & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/** Runs the boot script against a fake document and storage, and returns what it set on <html>. */
function boot(storage: ChoicesStorage | "throws"): Record<string, string> {
  const set: Record<string, string> = {};
  runInNewContext(BASIC_BOOT_SCRIPT, {
    document: { documentElement: { setAttribute: (name: string, value: string) => void (set[name] = value) } },
    localStorage:
      storage === "throws"
        ? {
            getItem: () => {
              throw new DOMException("blocked", "SecurityError");
            },
          }
        : storage,
  });
  return set;
}

describe("the boot script", () => {
  const saved = (value: unknown) => memoryStorage({ [DEVICE_CHOICES_KEY]: typeof value === "string" ? value : JSON.stringify(value) });

  it("sets data-basic=true before first paint when the saved choices say basic is on", () => {
    expect(boot(saved({ v: 1, lang: "ur", basic: true }))).toEqual({ [BASIC_ATTRIBUTE]: "true" });
  });

  it("leaves the page in normal mode for everything else", () => {
    for (const value of [{ v: 1 }, { v: 1, basic: false }, { v: 1, basic: "true" }, { v: 2, basic: true }, [true], "not json", "null", "7"]) {
      expect(boot(saved(value)), JSON.stringify(value)).toEqual({});
    }
    expect(boot(memoryStorage())).toEqual({});
    expect(boot("throws")).toEqual({});
  });

  it("agrees with the way the app reads the same text", () => {
    for (const raw of ['{"v":1,"basic":true}', '{"v":1,"basic":1}', '{"v":1,"basic":"yes","lang":"en"}', '{"v":3,"basic":true}', "[]", "{"]) {
      expect(Object.keys(boot(saved(raw))).length === 1, raw).toBe(isBasic(parseDeviceChoices(raw) ?? undefined));
    }
  });
});

describe("saving the choice", () => {
  it("writes basic into the device choices beside what is already there, and turning it off removes the field", () => {
    const storage = memoryStorage({ [DEVICE_CHOICES_KEY]: JSON.stringify({ v: 1, lang: "ta", buildings: ["100"] }) });
    const store = createChoicesStore(() => storage, undefined, () => 5);

    expect(saveBasicChoice(true, store)).toBe(true);
    expect(JSON.parse(storage.items.get(DEVICE_CHOICES_KEY)!)).toEqual({ v: 1, lang: "ta", buildings: ["100"], basic: true, savedAt: 5 });
    expect(isBasic(store.getSnapshot())).toBe(true);

    expect(saveBasicChoice(false, store)).toBe(true);
    expect(JSON.parse(storage.items.get(DEVICE_CHOICES_KEY)!)).toEqual({ v: 1, lang: "ta", buildings: ["100"], savedAt: 5 });
    expect(isBasic(store.getSnapshot())).toBe(false);
  });

  it("works with no choices yet, and writes nothing when the mode is already as asked", () => {
    const storage = memoryStorage();
    const store = createChoicesStore(() => storage, undefined, () => 1);

    expect(saveBasicChoice(false, store)).toBe(true);
    expect(storage.items.size).toBe(0);
    expect(saveBasicChoice(true, store)).toBe(true);
    expect(JSON.parse(storage.items.get(DEVICE_CHOICES_KEY)!)).toEqual({ v: 1, basic: true, savedAt: 1 });
  });

  it("says so when the phone refuses to keep it, and the mode then lasts for this session", () => {
    const refusing: ChoicesStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    const store = createChoicesStore(() => refusing, undefined, () => 1);

    expect(saveBasicChoice(true, store)).toBe(false);
    expect(isBasic(store.getSnapshot())).toBe(true);
  });
});

describe("applyBasic", () => {
  it("sets and removes the attribute", () => {
    const attributes = new Map<string, string>();
    const root = { setAttribute: (n: string, v: string) => void attributes.set(n, v), removeAttribute: (n: string) => void attributes.delete(n) };

    applyBasic(root, true);
    expect(attributes.get("data-basic")).toBe("true");
    applyBasic(root, false);
    expect(attributes.has("data-basic")).toBe(false);
  });
});
