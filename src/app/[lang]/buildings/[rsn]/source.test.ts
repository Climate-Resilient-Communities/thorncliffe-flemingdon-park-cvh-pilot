// The path from a saved contact to the resident (S02.08): the building page reads a building through Next's data
// cache under the tag building:{rsn}, and the Admin's "Save contact" drops that tag. The data cache is replaced here by
// a small one that works the same way (it keeps JSON, as Next's does, and drops every entry with a tag that is
// dropped), so the test fails when the tag is not set, is spelled differently on the two sides, or is not dropped.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicBuilding } from "@/modules/places";

const state = vi.hoisted(() => ({
  entries: new Map<string, { json: string; tags: string[] }>(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: () => Promise<unknown>, keys: string[], options: { tags: string[]; revalidate: number }) => async () => {
    const key = keys.join("/");
    let hit = state.entries.get(key);
    if (!hit) {
      hit = { json: JSON.stringify(await fn()), tags: options.tags };
      state.entries.set(key, hit);
    }
    return JSON.parse(hit.json);
  }),
  // The resident building list (S02.03) is expired by `finish`; this test is about the building's own entry.
  revalidateTag: vi.fn(),
  updateTag: vi.fn((tag: string) => {
    for (const [key, entry] of state.entries) if (entry.tags.includes(tag)) state.entries.delete(key);
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((location: string) => {
    throw new Error(`NEXT_REDIRECT ${location}`);
  }),
}));
vi.mock("@/platform/config/env", () => ({ getEnv: () => ({ fakeBuildingsFile: undefined }) }));
vi.mock("@/platform/db", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/places", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/places")>()), readPublicBuilding: vi.fn() }));
const setContact = vi.hoisted(() => vi.fn());
vi.mock("@/app/staff/places", () => ({ buildings: () => ({ setContact }) }));
// The guard is its own tested module: here it lets an Admin's session through to the action's own code.
vi.mock("@/app/staff/guard", () => ({
  staffAction:
    (_spec: unknown, act: (session: unknown, ...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      act({ staffId: "01900000-0000-7000-8000-0000000000aa" }, ...args),
}));

import { readPublicBuilding } from "@/modules/places";
import { unstable_cache, updateTag } from "next/cache";
import { setContactAction } from "@/app/staff/buildings/actions";
import { BUILDING_CONTACTS_TAG, BUILDING_REVALIDATE_SECONDS, buildingTag } from "@/app/buildingCache";
import { loadBuilding, restore, store } from "./source";

const read = vi.mocked(readPublicBuilding);

const building = (rsn: string, change: Partial<PublicBuilding> = {}): PublicBuilding => ({
  rsn,
  address: "4 Milepost Pl",
  neighbourhoodName: "Thorncliffe Park",
  storeys: 6,
  elevators: 2,
  emergencyPower: true,
  coolingRoom: false,
  airConditioning: "None",
  barrierFreeEntrance: true,
  factsUpdatedAt: new Date("2026-09-28T16:00:00Z"),
  checkingDetails: false,
  contact: null,
  ...change,
});

const contactOf = (phone: string, updatedAt: string): PublicBuilding["contact"] => ({ role: "superintendent", phone, owner: "hub", updatedAt: new Date(updatedAt) });

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
/** Saves a contact as an Admin; a saved contact ends in a redirect, which is thrown, so this returns what was thrown. */
const save = async (rsn: string): Promise<Error> => {
  let outcome: unknown;
  try {
    outcome = await setContactAction({ status: "idle" }, form({ rsn, role: "superintendent", phone: "416 555 0123", workNumber: "yes" }));
  } catch (error) {
    return error as Error;
  }
  throw new Error(`expected the save to redirect, it returned ${JSON.stringify(outcome)}`);
};

beforeEach(() => {
  state.entries.clear();
  vi.clearAllMocks();
});

describe("what the data cache keeps of a building", () => {
  it("is stored as JSON and restored with its dates as dates, the contact's too", () => {
    const original = building("4154146", { contact: contactOf("+14165550123", "2026-09-30T16:00:00Z") });

    const stored = store(original)!;
    expect(stored.factsUpdatedAt).toBe("2026-09-28T16:00:00.000Z");
    expect(stored.contact!.updatedAt).toBe("2026-09-30T16:00:00.000Z");

    const restored = restore(JSON.parse(JSON.stringify(stored)))!;
    expect(restored.factsUpdatedAt).toBeInstanceOf(Date);
    expect(restored.contact!.updatedAt).toBeInstanceOf(Date);
    expect(restored).toEqual(original);
  });

  it("keeps no contact as no contact, and no building as no building", () => {
    expect(restore(JSON.parse(JSON.stringify(store(building("1")))))!.contact).toBeNull();
    expect(store(null)).toBeNull();
    expect(restore(null)).toBeNull();
  });
});

describe("loadBuilding", () => {
  it("reads a building through the data cache under its own tag for five minutes, and hands back real dates", async () => {
    read.mockResolvedValue(building("4154146", { contact: contactOf("+14165550123", "2026-09-30T16:00:00Z") }));

    const found = await loadBuilding("4154146");

    expect(unstable_cache).toHaveBeenCalledWith(expect.any(Function), ["public-building", "4154146"], { revalidate: 300, tags: ["building:4154146"] });
    expect(BUILDING_REVALIDATE_SECONDS).toBe(300);
    expect(found!.factsUpdatedAt).toEqual(new Date("2026-09-28T16:00:00Z"));
    expect(found!.contact!.updatedAt).toEqual(new Date("2026-09-30T16:00:00Z"));
    expect(found!.contact!.updatedAt).toBeInstanceOf(Date);
  });

  it("asks the database once for a building however many visits follow", async () => {
    read.mockResolvedValue(building("4154146"));

    await loadBuilding("4154146");
    await loadBuilding("4154146");

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("is null for a building that is not there, and does not cache that, so numbers asked at random fill nothing", async () => {
    read.mockResolvedValue(null);

    expect(await loadBuilding("999")).toBeNull();
    expect(await loadBuilding("999")).toBeNull();

    expect(read).toHaveBeenCalledTimes(2);
    expect(state.entries.size).toBe(0);
  });

  it("is null, without asking the database, for something that is not a register number", async () => {
    expect(await loadBuilding("abc")).toBeNull();
    expect(await loadBuilding("1; drop table building")).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("saving the contact reaches the resident", () => {
  it("drops the building's cache entry, so the next visit reads the new contact", async () => {
    read.mockResolvedValueOnce(building("4154146")).mockResolvedValueOnce(building("4154146", { contact: contactOf("+14165550123", "2026-10-01T15:00:00Z") }));
    setContact.mockResolvedValue({ ok: true, value: { contact: { role: "superintendent", phone: "+14165550123", owner: "hub", updatedAt: new Date() } } });

    expect((await loadBuilding("4154146"))!.contact).toBeNull();
    expect((await loadBuilding("4154146"))!.contact).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);

    const outcome = await save("4154146");

    expect(outcome.message).toBe("NEXT_REDIRECT /staff/buildings?building=4154146&done=contact");
    // The building's own entry, and the list of contacts the essential-numbers page draws (S02.10).
    expect(updateTag).toHaveBeenCalledTimes(2);
    expect(updateTag).toHaveBeenCalledWith(buildingTag("4154146"));
    expect(updateTag).toHaveBeenCalledWith("building:4154146");
    expect(updateTag).toHaveBeenCalledWith(BUILDING_CONTACTS_TAG);
    expect((await loadBuilding("4154146"))!.contact).toMatchObject({ role: "superintendent", phone: "+14165550123" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("drops only that building: another building's entry stays", async () => {
    read.mockImplementation(async (_db, rsn) => building(rsn));
    setContact.mockResolvedValue({ ok: true, value: { contact: null } });
    await loadBuilding("4154146");
    await loadBuilding("4154159");

    await save("4154146");
    await loadBuilding("4154146");
    await loadBuilding("4154159");

    expect(read.mock.calls.map(([, rsn]) => rsn)).toEqual(["4154146", "4154159", "4154146"]);
  });

  it("drops nothing when the contact was refused, or is not saved", async () => {
    setContact.mockResolvedValue({ ok: false, error: "not_work_number" });

    const outcome = await setContactAction({ status: "idle" }, form({ rsn: "4154146", role: "superintendent", phone: "416 555 0123" }));

    expect(outcome).toMatchObject({ status: "refused" });
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("drops nothing for a register number that is not one", async () => {
    setContact.mockResolvedValue({ ok: true, value: { contact: null } });

    await save("4154146; drop");

    expect(updateTag).not.toHaveBeenCalled();
  });
});
