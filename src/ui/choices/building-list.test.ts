import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILDING_LIST_MAX_AGE_MS, BUILDING_LIST_URL, loadBuildingList, resetBuildingList, sortBuildings } from "./building-list";

const list = {
  v: 1,
  generated_at: "2026-05-01T12:00:00.000Z",
  buildings: [{ rsn: "100", address: "1 Test St", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", floors: [] }],
};
const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

afterEach(resetBuildingList);

describe("loadBuildingList", () => {
  it("asks for the public list with nothing about the resident, once, and has the browser revalidate its copy", async () => {
    const fetcher = answer(list);

    expect(await loadBuildingList(fetcher)).toEqual(list);
    expect(await loadBuildingList(fetcher)).toEqual(list);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(BUILDING_LIST_URL, { credentials: "omit", cache: "no-cache", headers: { Accept: "application/json" } });
    expect(BUILDING_LIST_URL).not.toContain("?");
  });

  it("keeps the list for the open page for 5 minutes, then asks again", async () => {
    let clock = 1_000_000;
    const first = answer(list);
    const second = answer({ ...list, generated_at: "2026-05-01T12:06:00.000Z" });

    await loadBuildingList(first, () => clock);
    clock += BUILDING_LIST_MAX_AGE_MS - 1;
    await loadBuildingList(first, () => clock);
    expect(first).toHaveBeenCalledTimes(1);

    clock += 1;
    const fresh = await loadBuildingList(second, () => clock);

    expect(second).toHaveBeenCalledTimes(1);
    expect(fresh?.generated_at).toBe("2026-05-01T12:06:00.000Z");
    expect(BUILDING_LIST_MAX_AGE_MS).toBe(5 * 60 * 1000);
  });

  it("does not take a list without generated_at", async () => {
    expect(await loadBuildingList(answer({ v: 1, buildings: list.buildings }))).toBeNull();
  });

  it.each([
    ["an error status", answer({ error: "unavailable" }, 503)],
    ["a list of the wrong shape", answer({ v: 1, generated_at: list.generated_at, buildings: [{ rsn: "x" }] })],
    ["something that is not JSON", vi.fn(async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch],
    [
      "a network failure",
      vi.fn(async () => {
        throw new TypeError("offline");
      }) as unknown as typeof fetch,
    ],
  ])("gives null for %s and tries again next time", async (_name, fetcher) => {
    expect(await loadBuildingList(fetcher)).toBeNull();

    const next = answer(list);
    expect(await loadBuildingList(next)).toEqual(list);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("sortBuildings", () => {
  const building = (rsn: string, address: string, neighbourhood = "Thorncliffe Park") => ({ rsn, address, neighbourhoodId: "x", neighbourhood, floors: [] });

  it("puts street numbers in numeric order, not text order", () => {
    const sorted = sortBuildings([building("1", "100 Overlea Blvd"), building("2", "9 Overlea Blvd"), building("3", "85 Overlea Blvd")]);

    expect(sorted.map((b) => b.address)).toEqual(["9 Overlea Blvd", "85 Overlea Blvd", "100 Overlea Blvd"]);
  });

  it("goes by neighbourhood first, and does not change the list it was given", () => {
    const given = [building("1", "1 Zed St", "Thorncliffe Park"), building("2", "99 Abe St", "Flemingdon Park"), building("3", "2 Zed St", "Thorncliffe Park")];

    expect(sortBuildings(given).map((b) => b.rsn)).toEqual(["2", "1", "3"]);
    expect(given.map((b) => b.rsn)).toEqual(["1", "2", "3"]);
  });
});
