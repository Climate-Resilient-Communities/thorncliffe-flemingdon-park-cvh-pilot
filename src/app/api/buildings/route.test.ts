import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuildingListSchema } from "@/contracts/buildingList";

// What the places module answers, set by each test. A plain function, not a spy: this test is about the route's answer.
let answer: () => Promise<unknown[]>;
let reads = 0;
vi.mock("@/modules/places", () => ({
  createResidentBuildings: () => ({
    list: () => {
      reads += 1;
      return answer();
    },
  }),
}));
vi.mock("@/platform/db", () => ({ getDb: () => ({}) }));

// Next's data cache, as far as the route depends on it: the function is run once and its value kept (a failure is not
// kept), and the options the route gave are recorded. Reset by `expire`, as revalidateTag does in the real cache.
const cacheOptions = vi.hoisted(() => ({ seen: [] as { keys?: string[]; options?: { revalidate?: number | false; tags?: string[] } }[] }));
const cached = vi.hoisted(() => ({ value: undefined as unknown, has: false }));
vi.mock("next/cache", () => ({
  unstable_cache:
    <T>(fn: () => Promise<T>, keys?: string[], options?: { revalidate?: number | false; tags?: string[] }) => {
      cacheOptions.seen.push({ keys, options });
      return async () => {
        if (!cached.has) {
          cached.value = await fn();
          cached.has = true;
        }
        return cached.value as T;
      };
    },
}));

const { GET } = await import("./route");
// Next calls the handler with the request; the handler does not read it, so the query string cannot change what is read.
const get = GET as unknown as (request: Request) => Promise<Response>;

const FLOOR = "0198a000-0000-7000-8000-000000000001";
const ONE = { rsn: "100", address: "1 Test St", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", floors: [{ id: FLOOR, label: "1" }] };

beforeEach(() => {
  answer = async () => [];
  reads = 0;
  cached.has = false;
});

describe("GET /api/buildings", () => {
  it("serves the public building list, shareable, with no cookie", async () => {
    answer = async () => [ONE];

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toMatch(/^public, /);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const body = BuildingListSchema.parse(await response.json());
    expect(body.buildings.map((b) => b.rsn)).toEqual(["100"]);
  });

  it("says when the list was read, so the phone can tell it from its own last write", async () => {
    answer = async () => [ONE];
    const before = Date.now();

    const body = BuildingListSchema.parse(await (await GET()).json());

    expect(Date.parse(body.generated_at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(body.generated_at)).toBeLessThanOrEqual(Date.now());
  });

  it("reads the database once however many requests come, even with different query strings", async () => {
    answer = async () => [ONE];

    const first = await (await get(new Request("http://localhost/api/buildings?a=1"))).json();
    const second = await (await get(new Request("http://localhost/api/buildings?a=2&b=3"))).json();
    await get(new Request("http://localhost/api/buildings"));

    expect(reads).toBe(1);
    // The same read, so the same generated_at: it is when the database was read, not when the request came.
    expect(second.generated_at).toBe(first.generated_at);
  });

  it("keeps the list for 5 minutes under the tag the staff actions revalidate", () => {
    expect(cacheOptions.seen).toHaveLength(1);
    expect(cacheOptions.seen[0].options).toEqual({ revalidate: 300, tags: ["resident-buildings"] });
  });

  it("says unavailable, not cached, when the list cannot be read", async () => {
    answer = () => Promise.reject(new Error("connection refused"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "unavailable" });
    // And the failure is not kept: the next request reads again.
    answer = async () => [ONE];
    expect((await GET()).status).toBe(200);
  });

  it("does not hand out a list that breaks the contract", async () => {
    answer = async () => [{ rsn: "not-a-number", address: "x", neighbourhoodId: "TP", neighbourhood: "TP", floors: [] }];

    expect((await GET()).status).toBe(503);
  });
});
