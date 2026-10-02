import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuildingListSchema } from "@/contracts/buildingList";

// What the places module answers, set by each test. A plain function, not a spy: this test is about the route's answer.
let answer: () => Promise<unknown[]>;
vi.mock("@/modules/places", () => ({ createResidentBuildings: () => ({ list: () => answer() }) }));
vi.mock("@/platform/db", () => ({ getDb: () => ({}) }));

const { GET } = await import("./route");

const FLOOR = "0198a000-0000-7000-8000-000000000001";

beforeEach(() => {
  answer = async () => [];
});

describe("GET /api/buildings", () => {
  it("serves the public building list, shareable, with no cookie", async () => {
    answer = async () => [{ rsn: "100", address: "1 Test St", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", floors: [{ id: FLOOR, label: "1" }] }];

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toMatch(/^public, /);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const body = BuildingListSchema.parse(await response.json());
    expect(body.buildings.map((b) => b.rsn)).toEqual(["100"]);
  });

  it("says unavailable, not cached, when the list cannot be read", async () => {
    answer = () => Promise.reject(new Error("connection refused"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "unavailable" });
  });

  it("does not hand out a list that breaks the contract", async () => {
    answer = async () => [{ rsn: "not-a-number", address: "x", neighbourhoodId: "TP", neighbourhood: "TP", floors: [] }];

    expect((await GET()).status).toBe(503);
  });
});
