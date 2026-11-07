import { describe, expect, it } from "vitest";
import { isOpenSpacePin, withSpaces, type ProviderPin } from "./places";

// The map's "Open as a space now" (the partner space, 2026-11-07): the provider pins with their status as a space, matched by place on the phone.
const pin = (id: string): ProviderPin => ({ kind: "provider", key: `${id}:0`, id, name: id, street: `${id} St`, lat: 43.7, lng: -79.34, marker: "cooling", label: null });
const NOW = Date.parse("2026-11-07T18:00:00Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

describe("withSpaces", () => {
  const spaces = new Map([
    ["M052", { status: "open" as const, purpose: "warming" as const, updated_at: at(50) }],
    ["M053", { status: "full" as const, purpose: "warming" as const, updated_at: at(15) }],
    ["M054", { status: "open" as const, purpose: "warming" as const, updated_at: at(410) }],
  ]);

  it("gives each place open or full as a space its status, and leaves the others as they were", () => {
    const [open, full, stale, other] = withSpaces([pin("M052"), pin("M053"), pin("M054"), pin("M001")], spaces, NOW);
    expect(open.space).toEqual({ status: "open", purpose: "warming", unconfirmed: false });
    expect(full.space).toEqual({ status: "full", purpose: "warming", unconfirmed: false });
    expect(stale.space).toEqual({ status: "open", purpose: "warming", unconfirmed: true });
    expect(other).toEqual(pin("M001"));
  });

  it("fills only a confirmed open space's pin: a full one, an unconfirmed one and a building keep their own look", () => {
    const pins = withSpaces([pin("M052"), pin("M053"), pin("M054"), pin("M001")], spaces, NOW);
    expect(pins.map(isOpenSpacePin)).toEqual([true, false, false, false]);
    expect(isOpenSpacePin({ kind: "building", key: "building:1", rsn: "1", address: "1 St", neighbourhood: "TP", lat: 43.7, lng: -79.34, marker: "building" })).toBe(false);
  });

  it("shows nothing as a space when the list could not be loaded (no guess)", () => {
    expect(withSpaces([pin("M052")], new Map(), NOW)[0].space).toBeUndefined();
  });
});
