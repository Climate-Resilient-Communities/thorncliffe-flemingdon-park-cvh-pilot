import { describe, expect, it } from "vitest";
import { decideConfirm, decidePublish, decideUnpublish, torontoDate, type ProviderState } from "./providerState";

const state = (change: Partial<ProviderState> = {}): ProviderState => ({ published: false, inCatalogue: true, lastConfirmed: "2026-09-30", ...change });

describe("publishing a provider", () => {
  it("is allowed once the provider has a last-confirmed date", () => {
    expect(decidePublish(state())).toEqual({ ok: true });
  });

  it("is refused with 'confirm first' when there is no last-confirmed date", () => {
    expect(decidePublish(state({ lastConfirmed: null }))).toEqual({ ok: false, error: "confirm_first" });
  });

  it("is refused for a provider that left the catalogue, whatever else is true", () => {
    expect(decidePublish(state({ inCatalogue: false }))).toEqual({ ok: false, error: "not_in_catalogue" });
    expect(decidePublish(state({ inCatalogue: false, lastConfirmed: null }))).toEqual({ ok: false, error: "not_in_catalogue" });
  });

  it("is refused for a provider already published", () => {
    expect(decidePublish(state({ published: true }))).toEqual({ ok: false, error: "already_published" });
  });
});

describe("unpublishing a provider", () => {
  it("is allowed for a published provider and refused otherwise", () => {
    expect(decideUnpublish(state({ published: true }))).toEqual({ ok: true });
    expect(decideUnpublish(state())).toEqual({ ok: false, error: "not_published" });
  });
});

describe("setting the last-confirmed date", () => {
  const today = "2026-10-02";

  it.each(["2026-10-02", "2026-10-01", "2020-02-29", "2025-12-31"])("accepts %s: today or earlier", (date) => {
    expect(decideConfirm(state(), date, today)).toEqual({ ok: true });
  });

  it("refuses a date after today", () => {
    expect(decideConfirm(state(), "2026-10-03", today)).toEqual({ ok: false, error: "date_in_future" });
    expect(decideConfirm(state(), "2027-01-01", today)).toEqual({ ok: false, error: "date_in_future" });
  });

  it.each(["", "yesterday", "2026-13-01", "2026-02-30", "2026-10-2", "10/02/2026", null, undefined, 20261002])("refuses %s as not a date", (date) => {
    expect(decideConfirm(state(), date, today)).toEqual({ ok: false, error: "date_invalid" });
  });

  it("refuses a provider that left the catalogue", () => {
    expect(decideConfirm({ inCatalogue: false }, "2026-10-01", today)).toEqual({ ok: false, error: "not_in_catalogue" });
  });
});

describe("torontoDate", () => {
  it("is the date in Toronto, not in UTC", () => {
    // 2026-10-03 02:30 UTC is still the evening of 2026-10-02 in Toronto (EDT, UTC-4).
    expect(torontoDate(new Date("2026-10-03T02:30:00Z"))).toBe("2026-10-02");
    expect(torontoDate(new Date("2026-10-03T04:00:00Z"))).toBe("2026-10-03");
  });

  it("follows the change to standard time", () => {
    // 2026-11-02 04:30 UTC is 2026-11-01 23:30 in Toronto (EST, UTC-5).
    expect(torontoDate(new Date("2026-11-02T04:30:00Z"))).toBe("2026-11-01");
    expect(torontoDate(new Date("2026-11-02T05:00:00Z"))).toBe("2026-11-02");
  });
});
