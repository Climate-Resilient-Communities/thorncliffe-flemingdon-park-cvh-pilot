import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_SPACES_MAX_AGE_MS, isUnconfirmedSpace, loadOpenSpaces, resetOpenSpaces, spacesByProvider } from "./open-spaces";

const LIST = {
  v: 1,
  generated_at: "2026-11-07T18:00:00.000Z",
  spaces: [{ provider_id: "M052", status: "open", purpose: "warming", updated_at: "2026-11-07T17:10:00.000Z" }],
};

const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

beforeEach(() => resetOpenSpaces());

describe("loadOpenSpaces (the partner space, 2026-11-07)", () => {
  it("asks /api/spaces with nothing about the resident: no query, no credentials, the same request for everyone (AD-3)", async () => {
    const fetcher = answer(200, LIST);
    expect(await loadOpenSpaces(fetcher)).toEqual(LIST.spaces);
    expect(fetcher).toHaveBeenCalledWith("/api/spaces", { credentials: "omit", cache: "no-cache", headers: { Accept: "application/json" } });
  });

  it("keeps the list for a minute, then asks again", async () => {
    const fetcher = answer(200, LIST);
    let now = 1_000;
    await loadOpenSpaces(fetcher, () => now);
    now += OPEN_SPACES_MAX_AGE_MS - 1;
    await loadOpenSpaces(fetcher, () => now);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 1;
    await loadOpenSpaces(fetcher, () => now);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("is null, and not remembered, when the server cannot answer or answers something that is not the list", async () => {
    expect(await loadOpenSpaces(answer(503, { error: "unavailable" }))).toBeNull();
    expect(await loadOpenSpaces(answer(200, { v: 1, spaces: "nope" }))).toBeNull();
    expect(await loadOpenSpaces(vi.fn(async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).toBeNull();
    expect(await loadOpenSpaces(answer(200, LIST))).toEqual(LIST.spaces);
  });
});

describe("spacesByProvider and isUnconfirmedSpace", () => {
  it("finds a space by its place, and calls it unconfirmed after 4 hours", () => {
    const spaces = spacesByProvider(LIST.spaces as never);
    expect(spaces.get("M052")?.purpose).toBe("warming");
    expect(spacesByProvider(null).size).toBe(0);
    const updated = Date.parse("2026-11-07T17:10:00.000Z");
    expect(isUnconfirmedSpace({ updated_at: "2026-11-07T17:10:00.000Z" }, updated + 240 * 60_000)).toBe(false);
    expect(isUnconfirmedSpace({ updated_at: "2026-11-07T17:10:00.000Z" }, updated + 240 * 60_000 + 1)).toBe(true);
  });
});
