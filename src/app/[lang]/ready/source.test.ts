// The path from the database to the Be ready pages (S02.10): how source.ts wires Next's data cache (the tags the Hub's
// save and the seed drop, and the 5 minutes), and what it does when a read fails. The data cache is replaced by a small
// one that keeps JSON the way Next's does and keeps nothing when the function throws.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResidentContent } from "@/modules/directory";

const state = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  wiring: [] as { keys: string[]; options: { tags: string[]; revalidate: number } }[],
  readContent: vi.fn(),
  listContacts: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: () => Promise<unknown>, keys: string[], options: { tags: string[]; revalidate: number }) => {
    state.wiring.push({ keys, options });
    return async () => {
      const key = keys.join("/");
      const hit = state.entries.get(key);
      if (hit !== undefined) return JSON.parse(hit);
      const value = await fn();
      state.entries.set(key, JSON.stringify(value));
      return JSON.parse(state.entries.get(key)!);
    };
  }),
}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T>(fn: T) => fn }));
vi.mock("@/platform/config/env", () => ({ getEnv: () => ({ fakeGuidesFile: undefined, fakeBuildingsFile: undefined }) }));
vi.mock("@/platform/db", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/directory", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/directory")>()), readResidentContent: (...args: unknown[]) => state.readContent(...args) }));
vi.mock("@/modules/places", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/places")>()), listBuildingContacts: (...args: unknown[]) => state.listContacts(...args) }));

// Imported once: the wiring is made when the module loads.
import { loadBuildingContacts, loadResidentContent } from "./source";

const CONTENT: ResidentContent = { guides: [{ id: "power", readMins: 3, lastUpdated: "2026-09-30", texts: { title: { en: "Power outage" } } }], numbers: [] };
const wiring = [...state.wiring];

beforeEach(() => {
  state.entries.clear();
  state.readContent.mockReset();
  state.listContacts.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("the data cache wiring", () => {
  it("keeps the guides and numbers under the guide-content tag and the buildings' contacts under building-contacts, each for 300 seconds", () => {
    const byKey = Object.fromEntries(wiring.map((entry) => [entry.keys.join("/"), entry.options]));

    expect(byKey).toEqual({
      "resident-guide-content": { revalidate: 300, tags: ["guide-content"] },
      "resident-building-contacts": { revalidate: 300, tags: ["building-contacts"] },
    });
  });
});

describe("a failed read", () => {
  it("gives no guides and no numbers, and logs one event without personal data", async () => {
    state.readContent.mockRejectedValue(new Error('select "id" from "guide" where ip = 203.0.113.9'));

    await expect(loadResidentContent()).resolves.toEqual({ guides: [], numbers: [] });

    const lines = vi.mocked(console.log).mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ level: "error", evt: "resident.content_read_failed", module: "app", source: "guides", error: "Error" });
    expect(lines[0]).not.toContain("203.0.113.9");
  });

  it("is never kept: the next visitor reads the database again and gets the guides once it answers", async () => {
    state.readContent.mockRejectedValueOnce(new Error("connection refused")).mockResolvedValue(CONTENT);

    expect((await loadResidentContent()).guides).toEqual([]);
    expect((await loadResidentContent()).guides).toHaveLength(1);
    expect(state.readContent).toHaveBeenCalledTimes(2);
  });

  it("gives no buildings when the contacts cannot be read, never keeps that, and logs it", async () => {
    state.listContacts.mockRejectedValueOnce(new Error("connection refused")).mockResolvedValue([{ rsn: "1", address: "4 Milepost Pl", contact: null }]);

    await expect(loadBuildingContacts()).resolves.toEqual([]);
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))).toMatchObject({ evt: "resident.content_read_failed", source: "building_contacts" });
    await expect(loadBuildingContacts()).resolves.toEqual([{ rsn: "1", address: "4 Milepost Pl", contact: null }]);
  });

  it("does not keep an answer that succeeded as empty-on-failure: a good answer is kept", async () => {
    state.readContent.mockResolvedValue(CONTENT);

    await loadResidentContent();
    await loadResidentContent();

    expect(state.readContent).toHaveBeenCalledTimes(1);
  });
});
