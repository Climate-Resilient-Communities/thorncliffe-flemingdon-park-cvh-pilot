import { describe, expect, it } from "vitest";
import { FILTERS_KEY, readFilters, saveFilters, withoutUnknownTopics, type FilterStorage } from "./filter-store";
import { NO_FILTERS, type FilterState } from "./filters";

function memory(): FilterStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value), removeItem: (key) => void data.delete(key) };
}

const applied: FilterState = { categories: ["food", "health"], neighbourhoods: ["FP"], emergency: true };

describe("the filters kept for the visit", () => {
  it("come back as they were saved, so opening a provider and going back keeps them", () => {
    const tab = memory();

    saveFilters(tab, applied);

    expect(readFilters(tab)).toEqual(applied);
  });

  it("are not kept when none is on, and what was kept is forgotten", () => {
    const tab = memory();
    saveFilters(tab, applied);

    saveFilters(tab, NO_FILTERS);

    expect(tab.data.size).toBe(0);
    expect(readFilters(tab)).toEqual(NO_FILTERS);
  });

  it("are kept under a name of their own, in the tab's storage and not under the kept listings' prefix", () => {
    const tab = memory();
    saveFilters(tab, applied);

    expect([...tab.data.keys()]).toEqual([FILTERS_KEY]);
    expect(FILTERS_KEY.startsWith("cvh.directory.")).toBe(false);
  });

  it.each([
    ["nothing kept", null],
    ["text that is not JSON", "not json"],
    ["a version that is not 1", JSON.stringify({ v: 2, categories: ["food"], neighbourhoods: [], emergency: false })],
    ["null", "null"],
  ])("are none for %s", (_name, raw) => {
    const tab = memory();
    if (raw !== null) tab.data.set(FILTERS_KEY, raw);

    expect(readFilters(tab)).toEqual(NO_FILTERS);
  });

  it("drop what is not a topic id or a pilot neighbourhood, and keep each once", () => {
    const tab = memory();
    tab.data.set(FILTERS_KEY, JSON.stringify({ v: 1, categories: ["food", "food", 7, ""], neighbourhoods: ["TP", "XX", "TP"], emergency: "yes" }));

    expect(readFilters(tab)).toEqual({ categories: ["food"], neighbourhoods: ["TP"], emergency: false });
  });

  it("are none, and saving does not throw, when the tab's storage is blocked or full", () => {
    expect(readFilters(null)).toEqual(NO_FILTERS);
    expect(() => saveFilters(null, applied)).not.toThrow();
    const blocked: FilterStorage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
      removeItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };

    expect(readFilters(blocked)).toEqual(NO_FILTERS);
    expect(() => saveFilters(blocked, applied)).not.toThrow();
    expect(() => saveFilters(blocked, NO_FILTERS)).not.toThrow();
  });

  it("lose a topic the release no longer has, and keep the rest, without making a new state when all are known", () => {
    expect(withoutUnknownTopics(applied, ["food"])).toEqual({ categories: ["food"], neighbourhoods: ["FP"], emergency: true });
    expect(withoutUnknownTopics(applied, ["food", "health", "legal"])).toBe(applied);
  });
});
