import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILDING_LIST_URL, loadBuildingList, resetBuildingList } from "./building-list";

const list = { v: 1, buildings: [{ rsn: "100", address: "1 Test St", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", floors: [] }] };
const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

afterEach(resetBuildingList);

describe("loadBuildingList", () => {
  it("asks for the public list with nothing about the resident, once", async () => {
    const fetcher = answer(list);

    expect(await loadBuildingList(fetcher)).toEqual(list);
    expect(await loadBuildingList(fetcher)).toEqual(list);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(BUILDING_LIST_URL, { credentials: "omit", headers: { Accept: "application/json" } });
    expect(BUILDING_LIST_URL).not.toContain("?");
  });

  it.each([
    ["an error status", answer({ error: "unavailable" }, 503)],
    ["a list of the wrong shape", answer({ v: 1, buildings: [{ rsn: "x" }] })],
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
