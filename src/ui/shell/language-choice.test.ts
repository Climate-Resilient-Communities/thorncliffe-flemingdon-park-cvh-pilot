import { describe, expect, it } from "vitest";
import { saveLanguageChoice } from "./language-choice";

function memory(initial: Record<string, string> = {}) {
  const items = { ...initial };
  return { items, getItem: (key: string) => items[key] ?? null, setItem: (key: string, value: string) => void (items[key] = value) };
}

describe("saveLanguageChoice", () => {
  it("saves the language under cvh.choices as {v: 1, lang}", () => {
    const storage = memory();

    expect(saveLanguageChoice(storage, "ur")).toBe(true);
    expect(JSON.parse(storage.items["cvh.choices"])).toEqual({ v: 1, lang: "ur" });
  });

  it("keeps the other choices that are saved", () => {
    const storage = memory({ "cvh.choices": '{"v":1,"lang":"en","buildings":["7"]}' });

    saveLanguageChoice(storage, "fr");

    expect(JSON.parse(storage.items["cvh.choices"])).toEqual({ v: 1, lang: "fr", buildings: ["7"] });
  });

  it("replaces a corrupt value instead of failing", () => {
    const storage = memory({ "cvh.choices": "{broken" });

    expect(saveLanguageChoice(storage, "ta")).toBe(true);
    expect(JSON.parse(storage.items["cvh.choices"])).toEqual({ v: 1, lang: "ta" });
  });

  it("returns false and does not throw when storage is missing or refuses", () => {
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };

    expect(saveLanguageChoice(undefined, "ur")).toBe(false);
    expect(saveLanguageChoice(refusing, "ur")).toBe(false);
  });
});
