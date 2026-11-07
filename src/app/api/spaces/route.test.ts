import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenSpacesSchema, RESIDENT_SPACES_TAG, UNCONFIRMED_AFTER_MS } from "@/contracts/openSpaces";
import { UNCONFIRMED_AFTER_MINUTES, type ResidentSpace } from "@/modules/partners";

// What the partners module answers, set by each test. The module's other exports (the constant the last test compares) are the real ones.
let answer: () => Promise<ResidentSpace[]>;
let reads = 0;
vi.mock("@/modules/partners", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/partners")>()),
  residentSpaces: () => {
    reads += 1;
    return answer();
  },
}));
vi.mock("@/platform/db", () => ({ getDb: () => ({}) }));

// Next's data cache, as far as the route depends on it (as in the building list's test): the function runs once and its value is kept, a
// failure is not kept, and the options the route gave are recorded.
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

const OPEN: ResidentSpace = { providerId: "M052", status: "open", purpose: "warming", confirmedAt: new Date("2026-11-07T17:10:00Z") };
const FULL: ResidentSpace = { providerId: "M053", status: "full", purpose: "warming", confirmedAt: new Date("2026-11-07T17:45:00Z") };

beforeEach(() => {
  answer = async () => [];
  reads = 0;
  cached.has = false;
});

describe("GET /api/spaces", () => {
  it("serves each open or full space by its place, purpose and confirmation time: public, shareable, with no cookie (AD-3)", async () => {
    answer = async () => [OPEN, FULL];

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toMatch(/^public, /);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const body = OpenSpacesSchema.parse(await response.json());
    expect(body.spaces).toEqual([
      { provider_id: "M052", status: "open", purpose: "warming", updated_at: "2026-11-07T17:10:00.000Z" },
      { provider_id: "M053", status: "full", purpose: "warming", updated_at: "2026-11-07T17:45:00.000Z" },
    ]);
  });

  it("carries nothing but the place, status, purpose and time: no organisation, capacity or person", async () => {
    answer = async () => [OPEN];
    const body = (await (await GET()).json()) as { spaces: Record<string, unknown>[] };
    expect(Object.keys(body.spaces[0]).sort()).toEqual(["provider_id", "purpose", "status", "updated_at"]);
  });

  it("reads the database through the data cache: once a minute at most, tagged so a Hub change shows at once", async () => {
    answer = async () => [OPEN];
    await GET();
    await GET();
    expect(reads).toBe(1);
    expect(cacheOptions.seen.at(-1)?.options).toEqual({ revalidate: 60, tags: [RESIDENT_SPACES_TAG] });
  });

  it("answers 503, never cached, when the spaces cannot be read, and keeps no failure", async () => {
    answer = async () => {
      throw new Error("down");
    };
    const failed = await GET();
    expect(failed.status).toBe(503);
    expect(failed.headers.get("Cache-Control")).toBe("no-store");
    answer = async () => [OPEN];
    expect((await GET()).status).toBe(200);
  });

  it("calls a space unconfirmed after the same time on the phone as on the Hub's board", () => {
    expect(UNCONFIRMED_AFTER_MS).toBe(UNCONFIRMED_AFTER_MINUTES * 60_000);
  });
});
